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
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { KreditoInsurancePool } from "./KreditoInsurancePool.sol";

/// @title KreditoVault
/// @author Kredito
/// @notice A single contract that is BOTH an ERC-4626 tokenized vault for LP capital AND an
///         attestation-gated undercollateralized lender, with ERC-7540 ASYNCHRONOUS REDEEM.
///
///         Supersedes `KreditoCreditVault`. The issuer-signed EIP-712 credit-attestation borrow
///         logic is ported byte-for-byte (domain "Kredito"/"1", chainId-bound, NO verifyingContract)
///         so the off-chain viem signer (`packages/nextjs/kredito/attestation.ts`) keeps working.
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
contract KreditoVault is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // EIP-712 — domain & types (must match the off-chain viem signer exactly)
    // PORTED VERBATIM from KreditoCreditVault. Do NOT change the preimages.
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

    /// @notice Principal currently lent out and not yet repaid (sum of all active loans' outstanding).
    uint256 public totalOutstanding;

    // ---------------------------------------------------------------------
    // Installment-lending constants & risk config (owner-settable, bounded)
    // ---------------------------------------------------------------------

    /// @notice 10_000 basis points = 100%.
    uint256 public constant BPS = 10_000;

    /// @notice Time between scheduled installments AND, separately, the grace window after a missed
    ///         due date before a loan can be defaulted. Both are 30 days by spec.
    uint256 public constant PAYMENT_INTERVAL = 30 days;
    uint256 public constant GRACE_PERIOD = 30 days;

    /// @notice Late fee applied to a payment made within the grace window (5% of the installment base).
    uint256 public constant LATE_FEE_BPS = 500;

    /// @notice Minimum / maximum loan term in monthly installments.
    uint256 public constant MIN_TERM_MONTHS = 6;
    uint256 public constant MAX_TERM_MONTHS = 36;

    /// @notice Fraction of `totalAssets()` kept as an un-lendable liquidity buffer (default 10%).
    uint256 public liquidityBufferBps = 1000;

    /// @notice Per-borrower exposure cap as a fraction of `totalAssets()` (default 5%).
    uint256 public borrowerExposureCapBps = 500;

    /// @notice Minimum insurance cover ratio required to originate a loan, in bps (default 20%).
    uint256 public minCoverRatioBps = 2000;

    /// @notice Fraction of each installment's interest streamed to the insurance pool (default 20%).
    uint256 public protocolFeeBps = 2000;

    /// @notice Annual interest rate (bps) per attestation risk tier index. Tier 1 = medium, 2 = low.
    ///         Defaults: 1 -> 10%, 2 -> 14%, 3 -> 18%. The borrower does NOT pick the tier; the rate is
    ///         derived from the attestation's `riskTier` so they cannot self-select a cheaper rate.
    mapping(uint8 => uint256) public tierToRateBps;

    // ---------------------------------------------------------------------
    // Insurance integration
    // ---------------------------------------------------------------------

    /// @notice The reserve pool paid on default and fed the protocol fee. Optional until set.
    KreditoInsurancePool public insurancePool;

    enum LoanStatus {
        None,
        Active,
        Grace,
        Defaulted,
        Repaid
    }

    struct Loan {
        address borrower;
        uint256 principal; // outstanding principal (decreases each installment)
        uint256 originalPrincipal; // disbursed amount (immutable)
        uint256 annualRateBps; // rate locked from the attestation tier at origination
        uint256 termMonths;
        uint256 principalPerInstallment; // equal-principal amortization (last installment clears remainder)
        uint256 paymentsMade;
        uint256 dueDate; // next installment due timestamp
        uint256 lastPaymentDate; // for accrued-interest-on-default math
        bytes32 attestationDigest;
        LoanStatus status;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;

    /// @notice Sum of outstanding principal across a borrower's ACTIVE loans, for the exposure cap.
    ///         Multiple concurrent loans per borrower are allowed (bounded by the cap).
    mapping(address => uint256) public activePrincipalByBorrower;

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
    error InvalidLoanState();
    error InvalidMinScore();
    error NotAuthorized();
    error InsufficientPending();
    error InsufficientClaimable();
    error PreviewNotSupported();
    error CannotOperateSelf();
    error InvalidTerm();
    error InvalidRate();
    error InvalidParam();
    error ExposureCapExceeded();
    error CoverRatioTooLow();
    error PaymentOverdue();
    error InsuranceNotSet();
    error NotDefaultable();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event MinScoreUpdated(uint256 previousMinScore, uint256 newMinScore);
    event AttestationVerified(
        address indexed borrower, bytes32 indexed attestationDigest, uint256 score, uint8 riskTier
    );

    /// @notice A new installment loan was originated.
    event LoanIssued(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 termMonths,
        uint256 annualRateBps,
        bytes32 indexed attestationDigest
    );

    /// @notice An installment payment was made. `principalPaid`/`interestPaid` decompose the base;
    ///         `lateFee` is non-zero only for grace payments; `protocolFee` went to the insurer.
    event PaymentMade(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 lateFee,
        uint256 protocolFee,
        uint256 remainingPrincipal
    );

    /// @notice A loan was fully amortized and closed.
    event LoanRepaid(uint256 indexed loanId, address indexed borrower);

    /// @notice A loan was defaulted. `recovered` came from the insurer; `badDebt` is borne by LPs.
    event LoanDefaulted(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 accruedInterest,
        uint256 recovered,
        uint256 badDebt
    );

    /// @notice The insurer paid less than the full claim on a default (partial / paused / reverting).
    event PartialInsurancePayout(uint256 indexed loanId, uint256 claim, uint256 recovered);

    /// @notice Risk parameters were updated.
    event RiskParamsUpdated(
        uint256 liquidityBufferBps, uint256 borrowerExposureCapBps, uint256 minCoverRatioBps, uint256 protocolFeeBps
    );

    /// @notice A tier's annual rate was set.
    event RateTierUpdated(uint8 indexed tier, uint256 annualRateBps);

    /// @notice The insurance pool address was set.
    event InsurancePoolUpdated(address indexed previousPool, address indexed newPool);

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

        // Domain separator pinned to this chain. Note the absence of `verifyingContract` —
        // the off-chain signer reproduces this exact preimage.
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(DOMAIN_NAME)), keccak256(bytes(DOMAIN_VERSION)), block.chainid
            )
        );

        // Default annual rates per attestation risk tier. Tier 1 = medium, 2 = low, 3 = (reserved).
        tierToRateBps[1] = 1000; // 10%
        tierToRateBps[2] = 1400; // 14%
        tierToRateBps[3] = 1800; // 18%

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
    function isEligible(CreditAttestation calldata att, bytes calldata sig) public view returns (bool) {
        return recoverIssuer(att, sig) == issuer && att.borrower != address(0) && block.timestamp < att.expiresAt
            && att.score >= minScore && att.riskTier != 0; // riskTier 0 = high default risk
    }

    // ---------------------------------------------------------------------
    // Installment lending (origination)
    // ---------------------------------------------------------------------

    /// @notice Originate an installment loan against an issuer-signed attestation. The borrower relays
    ///         the signature; the contract verifies it onchain, burns the attestation, and disburses the
    ///         principal from idle liquidity. The loan is tracked by the vault's own loan mapping; the
    ///         borrower's <label>.kredito.eth ENS identity is the credential. Caller pays gas.
    ///
    ///         The rate is derived from the attestation's `riskTier` (NOT chosen by the borrower):
    ///           - riskTier 2 (low)    -> `tierToRateBps[1]` (best rate)
    ///           - riskTier 1 (medium) -> `tierToRateBps[2]`
    ///         riskTier 0 (high) is already rejected by `isEligible`.
    ///
    ///         Amortization is EQUAL-PRINCIPAL and computed ON-CHAIN: each installment repays
    ///         `amount / termMonths` of principal plus interest on the outstanding balance. The final
    ///         installment clears the remainder so the principal sum is exact. This is the fix for the
    ///         reference design's soft-lock bug: by computing principal-per-installment on-chain (rather
    ///         than trusting a signer-supplied `monthlyPayment` that could be <= interest), every loan
    ///         is GUARANTEED to fully amortize in exactly `termMonths`, at any rate.
    ///
    /// @param att        The issuer-signed credit attestation.
    /// @param sig        The issuer's signature over `att`.
    /// @param amount     Principal to borrow.
    /// @param termMonths Loan term in monthly installments, in [MIN_TERM_MONTHS, MAX_TERM_MONTHS].
    /// @return loanId    The new loan id (the vault's own monotonic counter).
    function borrow(CreditAttestation calldata att, bytes calldata sig, uint256 amount, uint256 termMonths)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        if (amount == 0) revert ZeroAmount();
        if (msg.sender != att.borrower) revert NotBorrower();
        if (!isEligible(att, sig)) revert NotEligible();
        if (termMonths < MIN_TERM_MONTHS || termMonths > MAX_TERM_MONTHS) revert InvalidTerm();

        bytes32 digest = hashAttestation(att);
        if (attestationUsed[digest]) revert AttestationAlreadyUsed();

        // Derive the rate from the attestation tier; the borrower cannot self-select a cheaper one.
        uint256 rate = _rateForTier(att.riskTier);
        if (rate == 0) revert InvalidRate();

        // --- Risk gates ---
        // 1. Liquidity buffer: never lend out the protocol's safety buffer.
        uint256 buffer = (totalAssets() * liquidityBufferBps) / BPS;
        uint256 idle = idleLiquidity();
        if (idle <= buffer || amount > idle - buffer) revert InsufficientLiquidity();

        // 2. Per-borrower exposure cap.
        if (activePrincipalByBorrower[msg.sender] + amount > (totalAssets() * borrowerExposureCapBps) / BPS) {
            revert ExposureCapExceeded();
        }

        // 3. Insurance cover ratio (only if an insurer is wired).
        if (address(insurancePool) != address(0)) {
            if (insurancePool.coverRatio(totalOutstanding + amount) < minCoverRatioBps) revert CoverRatioTooLow();
        }

        // Equal-principal amortization, computed on-chain. The final installment clears the remainder.
        uint256 principalPerInstallment = amount / termMonths;

        // --- Effects (CEI) ---
        attestationUsed[digest] = true;
        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: amount,
            originalPrincipal: amount,
            annualRateBps: rate,
            termMonths: termMonths,
            principalPerInstallment: principalPerInstallment,
            paymentsMade: 0,
            dueDate: block.timestamp + PAYMENT_INTERVAL,
            lastPaymentDate: block.timestamp,
            attestationDigest: digest,
            status: LoanStatus.Active
        });
        totalOutstanding += amount;
        activePrincipalByBorrower[msg.sender] += amount;

        emit AttestationVerified(att.borrower, digest, att.score, att.riskTier);
        emit LoanIssued(loanId, msg.sender, amount, termMonths, rate, digest);

        // --- Interactions (last, CEI) ---
        IERC20(asset()).safeTransfer(msg.sender, amount);
    }

    /// @notice Make the next installment payment on a loan. Borrower-only, Active/Grace only.
    /// @dev    Interest accrues on the OUTSTANDING balance (`principal * rate / (BPS*12)` per month).
    ///         The principal portion is `principalPerInstallment`, except the final installment (or any
    ///         time the per-installment amount exceeds the remaining balance) which clears the whole
    ///         remainder. Together these guarantee full amortization in `termMonths` — immune to the
    ///         reference design's soft-lock.
    ///
    ///         Timing:
    ///           - on time (now <= dueDate):     pay `principalDue + interest`.
    ///           - within grace (<= dueDate+GRACE): pay `base + lateFee` (5% of base); status -> Grace.
    ///           - past grace:                   revert; the loan is now defaultable.
    ///
    ///         The protocol fee (`interest * protocolFeeBps / BPS`) is streamed to the insurer. The late
    ///         fee stays in the vault as LP yield.
    function makePayment(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active && loan.status != LoanStatus.Grace) revert InvalidLoanState();
        if (msg.sender != loan.borrower) revert NotBorrower();

        uint256 interest = (loan.principal * loan.annualRateBps) / (BPS * 12);

        // Final installment (or rounding remainder) clears the whole outstanding balance.
        bool isLast = (loan.paymentsMade + 1 >= loan.termMonths) || (loan.principalPerInstallment > loan.principal);
        uint256 principalDue = isLast ? loan.principal : loan.principalPerInstallment;

        uint256 base = principalDue + interest;

        uint256 lateFee = 0;
        if (block.timestamp > loan.dueDate) {
            if (block.timestamp > loan.dueDate + GRACE_PERIOD) revert PaymentOverdue();
            lateFee = (base * LATE_FEE_BPS) / BPS;
            loan.status = LoanStatus.Grace;
        }

        uint256 paymentDue = base + lateFee;
        uint256 protocolFee = address(insurancePool) != address(0) ? (interest * protocolFeeBps) / BPS : 0;

        // --- Effects (CEI) ---
        loan.principal -= principalDue;
        totalOutstanding -= principalDue;
        activePrincipalByBorrower[loan.borrower] -= principalDue;
        loan.paymentsMade += 1;
        loan.dueDate += PAYMENT_INTERVAL;
        loan.lastPaymentDate = block.timestamp;

        bool closed = loan.principal == 0;
        if (closed) {
            loan.status = LoanStatus.Repaid;
        } else if (lateFee == 0) {
            // A timely payment after a grace status restores Active.
            loan.status = LoanStatus.Active;
        }

        emit PaymentMade(loanId, loan.borrower, principalDue, interest, lateFee, protocolFee, loan.principal);
        if (closed) emit LoanRepaid(loanId, loan.borrower);

        // --- Interactions (last, CEI) ---
        // Pull the full payment in (principal + interest + late fee).
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), paymentDue);
        // Stream the protocol fee to the insurer as COVER-LP yield. The late fee stays here as LP yield.
        if (protocolFee > 0) {
            IERC20(asset()).safeTransfer(address(insurancePool), protocolFee);
        }
    }

    /// @notice Default a loan whose payment is past the grace window. Callable by ANYONE (keeper /
    ///         liquidator pattern — defaults must not depend on a privileged caller). Active/Grace only.
    /// @dev    Asks the insurer to cover
    ///         `principal + accruedInterest` via a TOLERANT call: the insurer call is wrapped in a
    ///         try/catch so a paused, reverting, or underfunded insurer can NEVER brick the default
    ///         (the reference design's `processClaim` was `whenNotPaused`, so pausing the insurer
    ///         bricked every default). Whatever is recovered offsets the loss; the rest is bad debt
    ///         borne by the LIVE LP share supply (totalAssets drops by `principal`, rises by
    ///         `recovered`).
    function processDefault(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active && loan.status != LoanStatus.Grace) revert InvalidLoanState();
        if (block.timestamp <= loan.dueDate + GRACE_PERIOD) revert NotDefaultable();

        uint256 principal = loan.principal;
        // Accrued interest since the last payment (simple, on the outstanding principal).
        uint256 elapsed = block.timestamp - loan.lastPaymentDate;
        uint256 accruedInterest = (principal * loan.annualRateBps * elapsed) / (365 days * BPS);
        uint256 claim = principal + accruedInterest;

        // --- Effects (CEI): write loan/accounting state BEFORE external calls. ---
        loan.status = LoanStatus.Defaulted;
        totalOutstanding -= principal;
        activePrincipalByBorrower[loan.borrower] -= principal;

        // --- Interactions ---
        // Tolerant insurer call: never let a paused/reverting/empty insurer brick the default.
        uint256 recovered = 0;
        if (address(insurancePool) != address(0)) {
            try insurancePool.processClaim(loanId, principal, accruedInterest, loanId) returns (uint256 paid) {
                recovered = paid;
            } catch {
                recovered = 0;
            }
        }

        uint256 badDebt = claim > recovered ? claim - recovered : 0;
        if (recovered < claim) emit PartialInsurancePayout(loanId, claim, recovered);
        emit LoanDefaulted(loanId, loan.borrower, principal, accruedInterest, recovered, badDebt);
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

    /// @notice Update the four bounded risk parameters in one call. Each must be <= BPS (100%).
    function setRiskParams(
        uint256 _liquidityBufferBps,
        uint256 _borrowerExposureCapBps,
        uint256 _minCoverRatioBps,
        uint256 _protocolFeeBps
    ) external onlyOwner {
        if (
            _liquidityBufferBps > BPS || _borrowerExposureCapBps > BPS || _minCoverRatioBps > BPS
                || _protocolFeeBps > BPS
        ) revert InvalidParam();
        liquidityBufferBps = _liquidityBufferBps;
        borrowerExposureCapBps = _borrowerExposureCapBps;
        minCoverRatioBps = _minCoverRatioBps;
        protocolFeeBps = _protocolFeeBps;
        emit RiskParamsUpdated(_liquidityBufferBps, _borrowerExposureCapBps, _minCoverRatioBps, _protocolFeeBps);
    }

    /// @notice Set the annual rate (bps) for a tier index. `tier` must be non-zero; `rate` <= BPS.
    function setRateTier(uint8 tier, uint256 annualRateBps) external onlyOwner {
        if (tier == 0) revert InvalidParam();
        if (annualRateBps > BPS) revert InvalidParam();
        tierToRateBps[tier] = annualRateBps;
        emit RateTierUpdated(tier, annualRateBps);
    }

    /// @notice Wire the insurance pool. Owner-only, non-zero.
    function setInsurancePool(address pool) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        emit InsurancePoolUpdated(address(insurancePool), pool);
        insurancePool = KreditoInsurancePool(pool);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// @dev Map an attestation `riskTier` to its annual rate. The borrower CANNOT pick a cheaper tier:
    ///        - riskTier 2 (low)    -> tierToRateBps[1] (best rate)
    ///        - riskTier 1 (medium) -> tierToRateBps[2]
    ///      Any other tier returns 0, which the caller treats as ineligible (`InvalidRate`).
    ///      (riskTier 0 is already rejected upstream by `isEligible`.)
    function _rateForTier(uint8 riskTier) internal view returns (uint256) {
        if (riskTier == 2) return tierToRateBps[1];
        if (riskTier == 1) return tierToRateBps[2];
        return 0;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }
}
