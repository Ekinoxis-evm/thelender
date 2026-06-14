// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title KreditoVault
/// @author Kredito
/// @notice A single contract that is BOTH an ERC-4626 tokenized vault for LP capital AND an
///         attestation-gated undercollateralized lender, with ERC-7540 ASYNCHRONOUS REDEEM.
///
///         Supersedes `KreditoCreditVault`. The issuer-signed EIP-712 credit-attestation borrow
///         logic uses domain "Kredito"/"1" bound to BOTH `chainId` AND `verifyingContract`
///         (= this vault's address, C-1) so a signature is only valid on this exact vault. The
///         off-chain viem signer (`packages/nextjs/kredito/attestation.ts`) must include
///         `verifyingContract` in its domain and `maxPrincipal` (H-2) in the attestation message.
///
///         === Why async redeem (ERC-7540) ===
///         This is a lending vault: LP capital can be lent out to borrowers (`totalOutstanding`) and
///         is therefore not always idle. A synchronous ERC-4626 redemption would let an LP pull
///         capital that is currently lent out, which the vault cannot honor. Instead, redemptions are
///         a two-phase async flow:
///           1. LP calls `requestRedeem` — shares are escrowed (transferred to the vault, NOT burned).
///           2. The owner/keeper calls `fulfillRedeem` once enough liquidity has freed up (borrowers
///              repaid). At that moment the exchange rate is LOCKED, the escrowed shares are burned,
///              and the owed assets are reserved (`totalClaimableAssets`).
///           3. LP (or its operator) calls `redeem`/`withdraw` to claim the reserved assets.
///         This is "design for incentives, not timers": the contract cannot self-execute, so the keeper
///         fulfills as capital frees. Reserved assets are excluded from `idleLiquidity()`, so a borrow
///         can never lend out capital already owed to a fulfilled redemption.
///
///         === ERC-7540 conformance ===
///         - requestId is always 0 (requests aggregate per `controller`).
///         - Deposits stay SYNCHRONOUS (standard ERC-4626 deposit/mint). We do NOT implement async
///           deposit, so `supportsInterface(0xce3bbe50)` is false.
///         - `previewRedeem`/`previewWithdraw` revert (no synchronous preview for async flows).
///         - Operator model + ERC-7575 `share()` + ERC-165 interface IDs implemented below.
contract KreditoVault is ERC4626, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // EIP-712 — domain & types (must match the off-chain viem signer exactly)
    // ---------------------------------------------------------------------

    /// @dev C-1 FIX: the domain now binds `verifyingContract` (= address(this)) in addition to
    ///      chainId. A signature is therefore valid ONLY on this exact vault, killing the prior
    ///      cross-deployment replay surface (an issuer signature for one vault could be relayed to a
    ///      sibling vault on the same chain). The off-chain viem signer MUST add
    ///      `verifyingContract: <vault address>` to its EIP-712 domain to mirror this preimage.
    ///      keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev H-2 FIX: `maxPrincipal` appended LAST (preserves prior field order so existing fields hash
    ///      identically) so the issuer binds the maximum loan size into the signature itself.
    ///      keccak256("CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt,uint256 maxPrincipal)")
    bytes32 public constant CREDIT_ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt,uint256 maxPrincipal)"
    );

    string public constant DOMAIN_NAME = "Kredito";
    string public constant DOMAIN_VERSION = "1";

    /// @notice H-1: maximum allowed lifetime (`expiresAt - issuedAt`) of an attestation. Caps how long
    ///         a stale credit signature can remain redeemable, bounding the issuer's exposure window.
    uint256 public constant MAX_ATTESTATION_TTL = 30 days;

    /// @notice Cached EIP-712 domain separator. Bound to `block.chainid` AND `address(this)` at deploy.
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice The issuer-signed credit attestation. `riskTier` mirrors CreditTypes.RiskTier:
    ///         0 = high (default risk), 1 = medium, 2 = low.
    /// @dev    `maxPrincipal` (H-2) is the issuer-bound upper bound on the loan amount; `borrow` enforces
    ///         `amount <= maxPrincipal`. It is the LAST field so existing field order is preserved.
    struct CreditAttestation {
        address borrower;
        uint256 score;
        uint8 riskTier;
        bytes32 evidenceDigest;
        uint256 issuedAt;
        uint256 expiresAt;
        uint256 maxPrincipal;
    }

    // ---------------------------------------------------------------------
    // ERC-165 interface IDs (ERC-7540 / ERC-7575)
    // ---------------------------------------------------------------------

    bytes4 private constant IID_ERC165 = 0x01ffc9a7;
    bytes4 private constant IID_OPERATOR = 0xe3bc4e65; // ERC-7540 operator methods
    bytes4 private constant IID_ERC7575 = 0x2f0a18c5; // ERC-7575 share() vault
    bytes4 private constant IID_ASYNC_REDEEM = 0x620ee8e4; // ERC-7540 async redeem
    bytes4 private constant IID_ASYNC_DEPOSIT = 0xce3bbe50; // ERC-7540 async deposit (NOT supported)

    // ---------------------------------------------------------------------
    // Lending state (ported)
    // ---------------------------------------------------------------------

    /// @notice The trusted signer. A valid attestation is one whose signature recovers to this.
    address public issuer;

    /// @notice Minimum score an attestation must carry to be eligible. Owner-tunable.
    uint256 public minScore = 750;

    /// @notice Upper bound on `minScore`. Scores are on a 0–1000 scale; bounding `setMinScore` here
    ///         prevents an accidental setting that no attestation could ever satisfy, which would
    ///         silently freeze all borrowing.
    uint256 public constant MAX_MIN_SCORE = 1000;

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

    /// @notice Replay / reuse guard: once an attestation digest has funded a loan it is burned.
    mapping(bytes32 => bool) public attestationUsed;

    // ---------------------------------------------------------------------
    // ERC-7540 async-redeem state
    // ---------------------------------------------------------------------

    /// @notice Shares requested for redemption but not yet fulfilled, per controller. Escrowed in
    ///         this contract's balance (transferred in, not yet burned).
    mapping(address => uint256) private _pendingRedeemShares;

    /// @notice Shares whose redemption has been fulfilled (rate locked, shares burned) and is awaiting
    ///         claim via `redeem`/`withdraw`, per controller.
    mapping(address => uint256) private _claimableRedeemShares;

    /// @notice Assets reserved against fulfilled-but-unclaimed redemptions, per controller. The rate is
    ///         locked at fulfillment time, so the claim pays exactly this.
    mapping(address => uint256) private _claimableRedeemAssets;

    /// @notice Total assets reserved for fulfilled redemptions across all controllers. Excluded from
    ///         `idleLiquidity()` so borrows can't lend out capital already owed to redeemers.
    uint256 public totalClaimableAssets;

    /// @notice ERC-7540 operator approvals. controller => operator => approved.
    mapping(address => mapping(address => bool)) private _isOperator;

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
    error NotAuthorized();
    error InsufficientPending();
    error InsufficientClaimable();
    error PreviewNotSupported();
    error CannotOperateSelf();
    error AmountExceedsCreditLimit();
    error AttestationNotYetValid();
    error AttestationExpired();
    error InvalidAttestationWindow();
    error AttestationTtlTooLong();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event MinScoreUpdated(uint256 previousMinScore, uint256 newMinScore);
    event AttestationVerified(
        address indexed borrower, bytes32 indexed attestationDigest, uint256 score, uint8 riskTier
    );
    event LoanIssued(
        uint256 indexed loanId, address indexed borrower, uint256 principal, bytes32 indexed attestationDigest
    );
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal);

    /// @notice ERC-7540 redeem request. `requestId` is always 0 (aggregated per controller).
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );

    /// @notice ERC-7540 operator approval set.
    event OperatorSet(address indexed controller, address indexed operator, bool approved);

    /// @notice Owner/keeper moved `shares` from pending → claimable for `controller`, locking the rate.
    event RedeemFulfilled(address indexed controller, uint256 shares, uint256 assets);

    /// @notice A PENDING (not-yet-fulfilled) redeem request was cancelled: escrowed shares returned.
    event RedeemRequestCancelled(address indexed controller, address indexed receiver, uint256 shares);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param _asset Loan/share asset (ERC20). The vault shares are minted by this contract.
    /// @param _issuer Trusted attestation signer.
    constructor(IERC20 _asset, address _issuer)
        ERC20("Kredito Vault Share", "kvSHARE")
        ERC4626(_asset)
        Ownable(msg.sender)
    {
        if (address(_asset) == address(0) || _issuer == address(0)) revert ZeroAddress();
        issuer = _issuer;

        // Domain separator pinned to this chain AND this contract (C-1). `verifyingContract` is
        // address(this), so a signature recovered here is only valid against THIS vault. The off-chain
        // signer must reproduce this exact preimage (chainId + verifyingContract = deployed address).
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );

        emit IssuerUpdated(address(0), _issuer);
    }

    // ---------------------------------------------------------------------
    // ERC-4626 accounting overrides
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC4626
    /// @dev Real backing for the LIVE share supply: idle assets held by the vault + principal
    ///      currently lent out, MINUS assets reserved against fulfilled-but-unclaimed redemptions.
    ///
    ///      The subtraction of `totalClaimableAssets` is the CRITICAL invariant: at `fulfillRedeem`
    ///      the escrowed shares are burned (supply drops) and the owed assets are set aside in
    ///      `totalClaimableAssets`, yet those assets still physically sit in `balanceOf(this)`.
    ///      Without excluding them, `totalAssets()` would keep counting reserved assets as backing
    ///      for the (now smaller) live supply, inflating the share price and letting any LP who
    ///      enters while a fulfilled-but-unclaimed redemption exists mint too few shares — robbing
    ///      every depositor. Excluding them keeps real backing == claim of the live `totalSupply`.
    ///
    ///      (Escrowed PENDING redeem shares the vault holds are share tokens, not the underlying
    ///      asset, so they never appear here.)
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalOutstanding - totalClaimableAssets;
    }

    /// @notice Free underlying liquidity available to lend: vault's asset balance minus assets that are
    ///         already reserved for fulfilled (claimable) redemptions.
    /// @dev    `totalClaimableAssets` is only ever increased in `fulfillRedeem` after asserting
    ///         `idleLiquidity() >= assets`, so the reserve can never exceed the asset balance and this
    ///         subtraction cannot underflow.
    function idleLiquidity() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - totalClaimableAssets;
    }

    /// @dev Inflation-attack hardening. A positive virtual-shares offset makes the classic
    ///      "deposit 1 wei, donate a large amount, steal the next depositor's deposit" attack
    ///      orders of magnitude unprofitable (the attacker must donate ~10**offset times the
    ///      victim's deposit to round their shares to zero). 6 matches the USDC asset decimals.
    ///      Note: this makes the share token's `decimals()` = asset decimals + 6.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------------
    // EIP-712 views (ported — shared with the frontend/server signer)
    // ---------------------------------------------------------------------

    /// @notice The cached EIP-712 domain separator (bound to chainId AND this vault's address).
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
                att.expiresAt,
                att.maxPrincipal
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Recover the signer of `sig` over `att`. If it equals `issuer`, the attestation is genuine.
    function recoverIssuer(CreditAttestation calldata att, bytes calldata sig) public view returns (address) {
        return hashAttestation(att).recover(sig);
    }

    /// @notice True iff the attestation is genuine (issuer-signed), fresh, and meets policy.
    /// @dev    Stateless view for frontend pre-flight. `borrow()` re-checks freshness via
    ///         `_assertFreshness` (which reverts with a precise error) and adds the one-time-use guard.
    function isEligible(CreditAttestation calldata att, bytes calldata sig) public view returns (bool) {
        return recoverIssuer(att, sig) == issuer && att.borrower != address(0) && _isFresh(att) && att.score >= minScore
            && att.riskTier != 0; // riskTier 0 = high default risk
    }

    /// @dev H-1: freshness predicate. An attestation is fresh iff it has started, has not expired, the
    ///      validity window is well-formed (expiry strictly after issuance), and the window is no longer
    ///      than `MAX_ATTESTATION_TTL`. Non-reverting form, used by `isEligible`.
    function _isFresh(CreditAttestation calldata att) internal view returns (bool) {
        return att.issuedAt <= block.timestamp && att.expiresAt > att.issuedAt && att.expiresAt > block.timestamp
            && att.expiresAt - att.issuedAt <= MAX_ATTESTATION_TTL;
    }

    /// @dev H-1: reverting form, used by `borrow` so the borrower gets a precise reason. Checks the same
    ///      conditions as `_isFresh` but distinguishes each failure mode.
    function _assertFreshness(CreditAttestation calldata att) internal view {
        if (att.issuedAt > block.timestamp) revert AttestationNotYetValid();
        if (att.expiresAt <= att.issuedAt) revert InvalidAttestationWindow();
        if (att.expiresAt <= block.timestamp) revert AttestationExpired();
        if (att.expiresAt - att.issuedAt > MAX_ATTESTATION_TTL) revert AttestationTtlTooLong();
    }

    // ---------------------------------------------------------------------
    // Borrowing (ported — disburses from idle liquidity, increments totalOutstanding)
    // ---------------------------------------------------------------------

    /// @notice Borrow against an issuer-signed attestation. The borrower relays the signature; the
    ///         contract verifies it onchain, burns the attestation, and disburses `asset` from idle
    ///         liquidity. Caller pays gas. Reverts if `amount > idleLiquidity()`.
    function borrow(CreditAttestation calldata att, bytes calldata sig, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        if (amount == 0) revert ZeroAmount();
        if (msg.sender != att.borrower) revert NotBorrower();
        if (amount > att.maxPrincipal) revert AmountExceedsCreditLimit(); // H-2: issuer-bound loan cap
        _assertFreshness(att); // H-1: precise freshness reverts
        if (!isEligible(att, sig)) revert NotEligible();
        if (openLoanOf[msg.sender] != 0) revert HasOpenLoan();

        bytes32 digest = hashAttestation(att);
        if (attestationUsed[digest]) revert AttestationAlreadyUsed();
        if (amount > idleLiquidity()) revert InsufficientLiquidity();

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
        totalOutstanding += amount;

        emit AttestationVerified(att.borrower, digest, att.score, att.riskTier);
        emit LoanIssued(loanId, msg.sender, amount, digest);

        // --- Interaction (last, CEI) ---
        IERC20(asset()).safeTransfer(msg.sender, amount);
    }

    /// @notice Borrower repays principal in full. Returns capital to idle liquidity, which is what lets
    ///         `fulfillRedeem` succeed afterwards.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        if (msg.sender != loan.borrower) revert NotBorrower();

        uint256 principal = loan.principal;
        loan.status = LoanStatus.Repaid;
        openLoanOf[loan.borrower] = 0;
        totalOutstanding -= principal;

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), principal);
        emit LoanRepaid(loanId, loan.borrower, principal);
    }

    /// @notice Owner marks a defaulted/written-off loan repaid for accounting (frees the borrower's
    ///         open-loan slot). No funds move; this realizes a loss against share price.
    /// @dev    LOSS POLICY (intended): writing a default off here lowers `totalOutstanding` and thus
    ///         `totalAssets()`, so the loss is borne by the LIVE share supply — i.e. LPs still holding
    ///         shares. It is NOT borne by redeemers whose requests were already fulfilled: at
    ///         `fulfillRedeem` their rate was locked and their assets were reserved into
    ///         `totalClaimableAssets` (excluded from `totalAssets()`), so a subsequent write-off cannot
    ///         claw back their claim. This rate-lock-at-fulfillment asymmetry is by design: fulfilled
    ///         redeemers have effectively exited; remaining LPs absorb post-fulfillment losses.
    function markLoanRepaid(uint256 loanId) external onlyOwner {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert InvalidLoanState();
        loan.status = LoanStatus.Repaid;
        openLoanOf[loan.borrower] = 0;
        totalOutstanding -= loan.principal;
        emit LoanRepaid(loanId, loan.borrower, loan.principal);
    }

    // ---------------------------------------------------------------------
    // ERC-7540 — operators
    // ---------------------------------------------------------------------

    /// @notice Approve/revoke `operator` to act for `msg.sender` (the controller) in async flows.
    function setOperator(address operator, bool approved) external returns (bool) {
        if (operator == msg.sender) revert CannotOperateSelf();
        _isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    /// @notice Whether `operator` may act for `controller`.
    function isOperator(address controller, address operator) public view returns (bool) {
        return _isOperator[controller][operator];
    }

    // ---------------------------------------------------------------------
    // ERC-7540 — async redeem request
    // ---------------------------------------------------------------------

    /// @notice Request to redeem `shares`. Shares are pulled from `owner` and ESCROWED in this vault
    ///         (transferred to address(this), NOT burned). The request aggregates under `controller`.
    /// @dev    Auth (three paths):
    ///           1. `owner == msg.sender`           — owner may route to any `controller`.
    ///           2. `isOperator(owner, msg.sender)` — operator may route to any `controller`.
    ///           3. ERC-20 share allowance fallback — `msg.sender` spends `owner`'s share allowance,
    ///              but is then FORCED to set `controller == owner`. A bare share approval is a
    ///              transfer authorization, NOT a redemption-routing authorization; without this
    ///              constraint any stray approval would be a confused-deputy that lets the approved
    ///              spender escrow the owner's shares under an attacker-chosen controller and drain
    ///              them on fulfillment. Owner/operator paths are unaffected.
    /// @return requestId Always 0 (requests aggregate per controller per the spec's "requestId 0" mode).
    function requestRedeem(uint256 shares, address controller, address owner)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0) || owner == address(0)) revert ZeroAddress();

        if (msg.sender != owner && !isOperator(owner, msg.sender)) {
            // Allowance fallback: the spender is NOT the owner and NOT an operator, so they may only
            // redeem to the owner itself — never to a caller-chosen controller.
            if (controller != owner) revert NotAuthorized();
            _spendAllowance(owner, msg.sender, shares);
        }

        // Escrow the shares: move them into the vault's custody now. Burned only at fulfillment.
        _transfer(owner, address(this), shares);
        _pendingRedeemShares[controller] += shares;

        emit RedeemRequest(controller, owner, 0, msg.sender, shares);
        return 0;
    }

    /// @notice Cancel a PENDING (not-yet-fulfilled) redeem request for `controller`, un-escrowing the
    ///         shares so an LP is not held hostage if the owner/keeper never fulfills. The shares are
    ///         transferred from the vault's custody back to the controller.
    /// @dev    Auth: `msg.sender == controller || isOperator(controller, msg.sender)`. Only PENDING
    ///         shares can be cancelled — fulfilled (claimable) shares are already burned at the locked
    ///         rate and can only be claimed via `redeem`/`withdraw`. Reverts if `shares` exceeds the
    ///         controller's pending balance.
    /// @param  shares     Amount of pending shares to un-escrow.
    /// @param  controller The request controller whose pending balance is reduced.
    function cancelRedeemRequest(uint256 shares, address controller) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0)) revert ZeroAddress();
        if (msg.sender != controller && !isOperator(controller, msg.sender)) revert NotAuthorized();
        if (shares > _pendingRedeemShares[controller]) revert InsufficientPending();

        // --- Effects ---
        _pendingRedeemShares[controller] -= shares;

        // --- Interaction (return the escrowed shares to the controller) ---
        _transfer(address(this), controller, shares);

        emit RedeemRequestCancelled(controller, controller, shares);
    }

    /// @notice Pending (not-yet-fulfilled) redeem shares for `controller`. MUST NOT include claimable,
    ///         MUST NOT vary by caller, MUST NOT revert. `requestId` is ignored (always 0).
    function pendingRedeemRequest(
        uint256,
        /* requestId */
        address controller
    )
        external
        view
        returns (uint256 shares)
    {
        return _pendingRedeemShares[controller];
    }

    /// @notice Shares whose redemption has been fulfilled and is awaiting claim for `controller`.
    function claimableRedeemRequest(
        uint256,
        /* requestId */
        address controller
    )
        external
        view
        returns (uint256 shares)
    {
        return _claimableRedeemShares[controller];
    }

    // ---------------------------------------------------------------------
    // ERC-7540 — fulfillment (implementation-defined; owner/keeper driven)
    // ---------------------------------------------------------------------

    /// @notice Owner/keeper fulfills `shares` of a controller's pending redeem request, moving them
    ///         pending → claimable. The exchange rate is LOCKED here: `assets = convertToAssets(shares)`
    ///         at the current rate. Requires `idleLiquidity() >= assets` (the vault cannot honor a
    ///         redemption without free capital). The escrowed shares are BURNED now and the assets are
    ///         reserved (`totalClaimableAssets += assets`), so a later borrow can't lend them out.
    /// @dev    This is the design-for-incentives lever: the keeper fulfills as borrowers repay and
    ///         liquidity frees up. Excess pending stays pending until more liquidity exists.
    function fulfillRedeem(address controller, uint256 shares)
        external
        onlyOwner
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (shares > _pendingRedeemShares[controller]) revert InsufficientPending();

        assets = convertToAssets(shares);
        if (idleLiquidity() < assets) revert InsufficientLiquidity();

        // --- Effects ---
        _pendingRedeemShares[controller] -= shares;
        _claimableRedeemShares[controller] += shares;
        _claimableRedeemAssets[controller] += assets;
        totalClaimableAssets += assets;

        // Burn the escrowed shares now — the vault holds them in custody.
        _burn(address(this), shares);

        emit RedeemFulfilled(controller, shares, assets);
    }

    // ---------------------------------------------------------------------
    // ERC-7540 — claim (overridden ERC-4626 redeem/withdraw)
    // ---------------------------------------------------------------------

    /// @notice Claim a fulfilled redemption, share-denominated. NOT a synchronous redemption.
    /// @dev    Auth: `msg.sender == controller || isOperator(controller, msg.sender)`. The shares were
    ///         already burned at fulfillment; this only releases the reserved assets at the locked rate.
    function redeem(uint256 shares, address receiver, address controller)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (msg.sender != controller && !isOperator(controller, msg.sender)) revert NotAuthorized();
        if (shares == 0) revert ZeroAmount();
        if (shares > _claimableRedeemShares[controller]) revert InsufficientClaimable();

        // Locked-rate assets for these shares (proportional within the controller's claimable bucket).
        assets = _claimableAssetsForShares(controller, shares);

        _decreaseClaimable(controller, shares, assets);
        IERC20(asset()).safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, controller, assets, shares);
    }

    /// @notice Claim a fulfilled redemption, asset-denominated. Symmetric to `redeem`.
    /// @dev    Auth: `msg.sender == controller || isOperator(controller, msg.sender)`.
    function withdraw(uint256 assets, address receiver, address controller)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (msg.sender != controller && !isOperator(controller, msg.sender)) revert NotAuthorized();
        if (assets == 0) revert ZeroAmount();
        if (assets > _claimableRedeemAssets[controller]) revert InsufficientClaimable();

        shares = _claimableSharesForAssets(controller, assets);

        _decreaseClaimable(controller, shares, assets);
        IERC20(asset()).safeTransfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, controller, assets, shares);
    }

    /// @dev Decrement a controller's claimable buckets and the global reserve.
    function _decreaseClaimable(address controller, uint256 shares, uint256 assets) internal {
        _claimableRedeemShares[controller] -= shares;
        _claimableRedeemAssets[controller] -= assets;
        totalClaimableAssets -= assets;
    }

    /// @dev Locked-rate assets owed for `shares` out of `controller`'s claimable bucket. If `shares`
    ///      equals the whole bucket, returns the whole asset reserve (avoids dust left behind).
    function _claimableAssetsForShares(address controller, uint256 shares) internal view returns (uint256) {
        uint256 totShares = _claimableRedeemShares[controller];
        uint256 totAssets = _claimableRedeemAssets[controller];
        if (shares == totShares) return totAssets;
        return (totAssets * shares) / totShares;
    }

    /// @dev Locked-rate shares burned for `assets` out of `controller`'s claimable bucket. If `assets`
    ///      equals the whole reserve, returns all remaining shares.
    function _claimableSharesForAssets(address controller, uint256 assets) internal view returns (uint256) {
        uint256 totShares = _claimableRedeemShares[controller];
        uint256 totAssets = _claimableRedeemAssets[controller];
        if (assets == totAssets) return totShares;
        return (totShares * assets) / totAssets;
    }

    // ---------------------------------------------------------------------
    // ERC-4626 max / preview overrides for the async model
    //
    // COMPOSABILITY WARNING: this is an ERC-7540 async-redeem vault, so the redemption side does NOT
    // follow generic ERC-4626 semantics. `maxRedeem`/`maxWithdraw` return the async *claimable*
    // maxima (what `redeem`/`withdraw` can release right now at the already-locked rate), NOT a
    // synchronous redeemable amount, and `previewRedeem`/`previewWithdraw` REVERT (an async rate is
    // only knowable after `fulfillRedeem`). Generic ERC-4626 routers/zappers that assume
    // `previewRedeem` works or that `maxRedeem > 0` implies a synchronous redeem will NOT compose
    // with this vault. The deposit side (`deposit`/`mint`/`previewDeposit`/`maxDeposit`) stays fully
    // synchronous and ERC-4626-standard.
    // ---------------------------------------------------------------------

    /// @notice ASYNC claimable maximum: shares whose redemption has been fulfilled and can be claimed
    ///         now for `controller`. NOT a synchronous redeemable amount.
    function maxRedeem(address controller) public view override returns (uint256) {
        return _claimableRedeemShares[controller];
    }

    /// @notice ASYNC claimable maximum: assets reserved (rate-locked) for `controller` that can be
    ///         claimed now. NOT a synchronous withdrawable amount.
    function maxWithdraw(address controller) public view override returns (uint256) {
        return _claimableRedeemAssets[controller];
    }

    /// @notice Async: no synchronous preview exists (the rate is only fixed at `fulfillRedeem`).
    ///         MUST revert for all inputs — do not rely on this in generic ERC-4626 routers.
    function previewRedeem(uint256) public pure override returns (uint256) {
        revert PreviewNotSupported();
    }

    /// @notice Async: no synchronous preview exists (the rate is only fixed at `fulfillRedeem`).
    ///         MUST revert for all inputs — do not rely on this in generic ERC-4626 routers.
    function previewWithdraw(uint256) public pure override returns (uint256) {
        revert PreviewNotSupported();
    }

    // ---------------------------------------------------------------------
    // ERC-7575
    // ---------------------------------------------------------------------

    /// @notice ERC-7575: the share token for this vault is this contract itself.
    function share() external view returns (address) {
        return address(this);
    }

    // ---------------------------------------------------------------------
    // ERC-165
    // ---------------------------------------------------------------------

    /// @notice ERC-165. True for ERC-165, ERC-7540 operator methods, ERC-7575, and async redeem.
    ///         False for async deposit (we do synchronous deposits). The ERC-4626/ERC-20 interface is
    ///         exposed via the inherited ABI.
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        if (interfaceId == IID_ASYNC_DEPOSIT) return false;
        return interfaceId == IID_ERC165 || interfaceId == IID_OPERATOR || interfaceId == IID_ERC7575
            || interfaceId == IID_ASYNC_REDEEM;
    }

    // ---------------------------------------------------------------------
    // Admin (ported)
    // ---------------------------------------------------------------------

    /// @notice Owner pauses new borrows (H-3). Existing loans/repay/redeem flows are unaffected — this
    ///         is a circuit breaker for the credit-attestation surface (e.g. a leaked issuer key).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Owner lifts the borrow pause (H-3).
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set the trusted attestation signer.
    /// @dev    SECURITY (H-3): the deploy script sets `issuer == deployer` for DEMO convenience only.
    ///         In production the issuer MUST be a hardened signer — a multisig or HSM-backed key —
    ///         NOT an EOA controlled by the deployer. A compromised issuer key can mint arbitrary
    ///         creditworthiness; rotate to a multisig/HSM via this function immediately after deploy.
    function setIssuer(address newIssuer) external onlyOwner {
        if (newIssuer == address(0)) revert ZeroAddress();
        emit IssuerUpdated(issuer, newIssuer);
        issuer = newIssuer;
    }

    function setMinScore(uint256 newMinScore) external onlyOwner {
        if (newMinScore == 0 || newMinScore > MAX_MIN_SCORE) revert InvalidMinScore();
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
