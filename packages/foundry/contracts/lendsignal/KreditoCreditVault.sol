// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title KreditoCreditVault
/// @author Kredito
/// @notice Undercollateralized lending vault gated by an ISSUER-SIGNED, EIP-712 credit
///         attestation that is verified ONCHAIN at borrow time.
///
///         Trust model — the ISSUER signature is the anchor, NOT the borrower's.
///         The protocol (issuer) runs the off-chain scoring pipeline (Confidential AI
///         attester + bureau), then signs a `CreditAttestation` that names the borrower,
///         their score, risk tier and an evidence digest. Anyone can submit that signature,
///         but only `issuer` can produce one that recovers correctly, so a borrower cannot
///         forge their own creditworthiness. This replaces the trusted-write
///         `CreditCertificateRegistry` (where the issuer had to send an onchain tx per user)
///         with a stateless, gasless attestation the issuer signs off-chain and the borrower
///         relays — the chain only pays gas when capital actually moves.
///
///         EIP-712 binding — the domain deliberately OMITS `verifyingContract` and binds only
///         to `chainId`. That lets the signing server produce attestations WITHOUT knowing the
///         deployed vault address (useful across redeploys / pre-deploy demos) while still
///         pinning each signature to a single chain to stop cross-chain replay. The struct hash
///         and digest are assembled by hand here (not via OZ's `EIP712` base, which would force
///         `verifyingContract` into the domain) so the viem signer can mirror them byte-for-byte.
contract KreditoCreditVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // EIP-712 — domain & types (must match the off-chain viem signer exactly)
    // ---------------------------------------------------------------------

    /// @dev EIP712Domain WITHOUT `verifyingContract`. chainId-bound only.
    ///      keccak256("EIP712Domain(string name,string version,uint256 chainId)")
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");

    /// @dev keccak256("CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)")
    bytes32 public constant CREDIT_ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)"
    );

    string public constant DOMAIN_NAME = "Kredito";
    string public constant DOMAIN_VERSION = "1";

    /// @notice Cached EIP-712 domain separator. Bound to `block.chainid` at deploy time.
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice The issuer-signed credit attestation. `riskTier` mirrors CreditTypes.RiskTier:
    ///         0 = high (default risk), 1 = medium, 2 = low.
    struct CreditAttestation {
        address borrower;
        uint256 score;
        uint8 riskTier;
        bytes32 evidenceDigest;
        uint256 issuedAt;
        uint256 expiresAt;
    }

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The trusted signer. A valid attestation is one whose signature recovers to this.
    address public issuer;

    /// @notice Loan asset (e.g. USDC — 6 decimals on Sepolia/mainnet, verify on chain).
    IERC20 public immutable asset;

    /// @notice Minimum score an attestation must carry to be eligible. Owner-tunable.
    uint256 public minScore = 750;

    /// @notice LP capital available to lend, in `asset` units.
    uint256 public liquidity;

    /// @notice Principal currently lent out and not yet repaid.
    uint256 public totalOutstanding;

    enum LoanStatus {
        None,
        Active,
        Repaid
    }

    struct Loan {
        address borrower;
        uint256 principal;
        bytes32 attestationDigest;
        uint256 borrowedAt;
        LoanStatus status;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;

    /// @notice One open loan per borrower at a time. 0 = none.
    mapping(address => uint256) public openLoanOf;

    /// @notice Replay / reuse guard: once an attestation digest has funded a loan it is burned,
    ///         so the same signed attestation can never be relayed twice.
    mapping(bytes32 => bool) public attestationUsed;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error NotEligible();
    error NotBorrower();
    error AttestationAlreadyUsed();
    error InsufficientLiquidity();
    error HasOpenLoan();
    error InvalidLoanState();
    error InvalidMinScore();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event MinScoreUpdated(uint256 previousMinScore, uint256 newMinScore);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AttestationVerified(
        address indexed borrower, bytes32 indexed attestationDigest, uint256 score, uint8 riskTier
    );
    event LoanIssued(
        uint256 indexed loanId, address indexed borrower, uint256 principal, bytes32 indexed attestationDigest
    );
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param _asset Loan asset (ERC20).
    /// @param _issuer Trusted attestation signer.
    constructor(IERC20 _asset, address _issuer) Ownable(msg.sender) {
        if (address(_asset) == address(0) || _issuer == address(0)) revert ZeroAddress();
        asset = _asset;
        issuer = _issuer;

        // Domain separator is computed once, pinned to this chain. Note the absence of
        // `verifyingContract` — the off-chain signer reproduces this exact preimage.
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(DOMAIN_NAME)), keccak256(bytes(DOMAIN_VERSION)), block.chainid
            )
        );

        emit IssuerUpdated(address(0), _issuer);
    }

    // ---------------------------------------------------------------------
    // EIP-712 views (shared with the frontend/server signer)
    // ---------------------------------------------------------------------

    /// @notice The cached EIP-712 domain separator (chainId-bound, no verifyingContract).
    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    /// @notice The EIP-191/712 digest the issuer signs for `att`.
    function hashAttestation(CreditAttestation calldata att) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                CREDIT_ATTESTATION_TYPEHASH,
                att.borrower,
                att.score,
                att.riskTier,
                att.evidenceDigest,
                att.issuedAt,
                att.expiresAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Recover the signer of `sig` over `att`. If it equals `issuer`, the attestation is genuine.
    function recoverIssuer(CreditAttestation calldata att, bytes calldata sig) public view returns (address) {
        return hashAttestation(att).recover(sig);
    }

    /// @notice True iff the attestation is genuine (issuer-signed), unexpired, and meets policy.
    /// @dev    Stateless view — does NOT consult the replay guard, so the frontend can pre-flight
    ///         eligibility before a borrow. `borrow()` adds the one-time-use check on top.
    function isEligible(CreditAttestation calldata att, bytes calldata sig) public view returns (bool) {
        return recoverIssuer(att, sig) == issuer && att.borrower != address(0) && block.timestamp < att.expiresAt
            && att.score >= minScore && att.riskTier != 0; // riskTier 0 = high default risk
    }

    // ---------------------------------------------------------------------
    // Liquidity (LPs)
    // ---------------------------------------------------------------------

    /// @notice Supply `asset` to the lending pool. Caller must approve first.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        liquidity += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner withdraws idle liquidity (e.g. to rebalance). Cannot touch lent-out principal.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > liquidity) revert InsufficientLiquidity();
        liquidity -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Borrowing
    // ---------------------------------------------------------------------

    /// @notice Borrow against an issuer-signed attestation. The borrower relays the signature;
    ///         the contract verifies it onchain, burns the attestation, and disburses `asset`.
    /// @param att The attestation. `att.borrower` MUST equal `msg.sender`.
    /// @param sig The issuer's EIP-712 signature over `att`.
    /// @param amount Principal to borrow.
    function borrow(CreditAttestation calldata att, bytes calldata sig, uint256 amount)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        if (amount == 0) revert ZeroAmount();
        if (msg.sender != att.borrower) revert NotBorrower();
        if (!isEligible(att, sig)) revert NotEligible();
        if (openLoanOf[msg.sender] != 0) revert HasOpenLoan();

        bytes32 digest = hashAttestation(att);
        if (attestationUsed[digest]) revert AttestationAlreadyUsed();
        if (amount > liquidity) revert InsufficientLiquidity();

        // --- Effects ---
        attestationUsed[digest] = true;
        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: amount,
            attestationDigest: digest,
            borrowedAt: block.timestamp,
            status: LoanStatus.Active
        });
        openLoanOf[msg.sender] = loanId;
        liquidity -= amount;
        totalOutstanding += amount;

        emit AttestationVerified(att.borrower, digest, att.score, att.riskTier);
        emit LoanIssued(loanId, msg.sender, amount, digest);

        // --- Interaction (last, CEI) ---
        asset.safeTransfer(msg.sender, amount);
    }

    /// @notice Borrower repays principal in full. Returns capital to the lending pool.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        if (msg.sender != loan.borrower) revert NotBorrower();

        uint256 principal = loan.principal;
        loan.status = LoanStatus.Repaid;
        openLoanOf[loan.borrower] = 0;
        liquidity += principal;
        totalOutstanding -= principal;

        asset.safeTransferFrom(msg.sender, address(this), principal);
        emit LoanRepaid(loanId, loan.borrower, principal);
    }

    /// @notice Owner marks a defaulted/written-off loan repaid for accounting (frees the borrower's
    ///         open-loan slot). Minimal admin escape hatch; no funds move.
    function markLoanRepaid(uint256 loanId) external onlyOwner {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        loan.status = LoanStatus.Repaid;
        openLoanOf[loan.borrower] = 0;
        totalOutstanding -= loan.principal;
        emit LoanRepaid(loanId, loan.borrower, loan.principal);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setIssuer(address newIssuer) external onlyOwner {
        if (newIssuer == address(0)) revert ZeroAddress();
        emit IssuerUpdated(issuer, newIssuer);
        issuer = newIssuer;
    }

    function setMinScore(uint256 newMinScore) external onlyOwner {
        if (newMinScore == 0) revert InvalidMinScore();
        emit MinScoreUpdated(minScore, newMinScore);
        minScore = newMinScore;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }
}
