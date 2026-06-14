// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @title KreditoInsurancePool
/// @author Kredito
/// @notice An ERC-4626 reserve vault ("COVER" shares) holding the SAME stablecoin asset as
///         `KreditoVault`. COVER LPs deposit the stablecoin to back the lending vault against
///         borrower defaults; in return they earn the protocol fee (a fraction of loan interest)
///         which the vault streams in as raw `safeTransfer` (yield, no shares minted).
///
///         === Why a separate ERC-4626 pool ===
///         Reserves are passively held, never lent out, so unlike `KreditoVault` redemptions here
///         CAN be synchronous standard ERC-4626 — there is no "capital is lent out" liquidity
///         problem to solve. The pool only ever pays the lending vault on a default (`processClaim`),
///         and receives fee yield.
///
///         === Bugs from the reference design this contract FIXES ===
///           - (3) `processClaim` is NOT `whenNotPaused`. In the reference design a paused insurer
///             bricked every default in the lender. Here a default must ALWAYS finalize, so claims
///             are payable even while paused (pausing only halts NEW deposits/mints).
///           - `processClaim` pays `min(owed, totalAssets())` and NEVER reverts on underfunding —
///             the deficit is recorded as bad debt, so an underfunded pool cannot DoS defaults.
///           - (4) adds an inflation `_decimalsOffset() = 6` (the reference pool had none).
///           - (5) `Ownable2Step` instead of single-step `Ownable`.
contract KreditoInsurancePool is ERC4626, Ownable2Step, Pausable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    /// @notice The KreditoVault — the ONLY address allowed to call `processClaim`. Owner-settable.
    address public vault;

    /// @notice 10_000 basis points = 100%.
    uint256 public constant BPS = 10_000;

    /// @notice Hard upper bound on `redeemCooldown` (the setter rejects anything larger). Keeps the
    ///         owner from setting a punitive lock that would strand COVER LPs.
    uint256 public constant MAX_REDEEM_COOLDOWN = 7 days;

    /// @notice Minimum time a COVER deposit must age before the depositor (the share `owner`) can
    ///         withdraw/redeem it. Defends the lending vault's `coverRatio` borrow gate against the
    ///         atomic deposit -> borrow -> redeem round-trip (see `coverRatio` NatSpec): freshly
    ///         deposited reserves cannot be borrowed-against and immediately yanked in the same
    ///         tx/block. Owner-settable up to `MAX_REDEEM_COOLDOWN`.
    uint256 public redeemCooldown = 1 hours;

    /// @notice Last deposit/mint timestamp per receiver. A withdraw/redeem is gated on
    ///         `block.timestamp >= lastDepositAt[owner] + redeemCooldown`.
    mapping(address => uint256) public lastDepositAt;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error OnlyVault();
    error CooldownActive();
    error CooldownTooLong();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event VaultUpdated(address indexed previousVault, address indexed newVault);

    /// @notice The redeem cooldown was changed.
    event RedeemCooldownUpdated(uint256 previousCooldown, uint256 newCooldown);

    /// @notice A default claim was settled. `amountPaid` was transferred to the vault; `badDebt` is the
    ///         uncovered remainder the pool could not honor (it does NOT revert — defaults must finalize).
    event ClaimPaid(
        uint256 indexed loanId,
        uint256 indexed nftId,
        uint256 principal,
        uint256 interest,
        uint256 amountPaid,
        uint256 badDebt
    );

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param _asset The stablecoin reserve asset (MUST equal KreditoVault's asset).
    constructor(IERC20 _asset) ERC20("Kredito Cover Share", "kcCOVER") ERC4626(_asset) Ownable(msg.sender) {
        if (address(_asset) == address(0)) revert ZeroAddress();
    }

    // ---------------------------------------------------------------------
    // ERC-4626 hardening
    // ---------------------------------------------------------------------

    /// @dev Same 6-decimal virtual-shares offset as KreditoVault: makes the first-depositor /
    ///      inflation attack orders of magnitude unprofitable. Matches the 6-decimal USDC asset.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------------
    // ERC-4626 deposit/mint — pausable (NEW reserves can be halted; claims cannot)
    // ---------------------------------------------------------------------

    /// @notice Standard ERC-4626 deposit. Pausable so the owner can stop NEW reserve inflows in an
    ///         emergency WITHOUT bricking default settlement (claims stay payable, see `processClaim`).
    /// @dev    Stamps `lastDepositAt[receiver]` so the freshly deposited cover is locked for
    ///         `redeemCooldown`. The cooldown is INDEPENDENT of the pause: deposits/mints stay behind
    ///         `whenNotPaused`, withdraw/redeem are never paused but are cooldown-gated on the owner.
    function deposit(uint256 assets, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
        lastDepositAt[receiver] = block.timestamp;
        return super.deposit(assets, receiver);
    }

    /// @notice Standard ERC-4626 mint. Pausable, see `deposit`. Stamps the receiver's cooldown.
    function mint(uint256 shares, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
        lastDepositAt[receiver] = block.timestamp;
        return super.mint(shares, receiver);
    }

    /// @notice Standard ERC-4626 withdraw. COVER LPs can exit synchronously (reserves are never lent
    ///         out). NOT paused — LPs must always be able to pull their reserves — but cooldown-gated:
    ///         reverts `CooldownActive` until `redeemCooldown` has elapsed since the share `owner`'s
    ///         last deposit/mint. See `coverRatio` for why this gate exists.
    function withdraw(uint256 assets, address receiver, address owner) public override nonReentrant returns (uint256) {
        if (block.timestamp < lastDepositAt[owner] + redeemCooldown) revert CooldownActive();
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice Standard ERC-4626 redeem. Synchronous, not paused (see `withdraw`). Cooldown-gated on
    ///         the share `owner`: reverts `CooldownActive` until `redeemCooldown` has elapsed since
    ///         their last deposit/mint.
    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256) {
        if (block.timestamp < lastDepositAt[owner] + redeemCooldown) revert CooldownActive();
        return super.redeem(shares, receiver, owner);
    }

    // ---------------------------------------------------------------------
    // Claims — the vault calls this on a borrower default
    // ---------------------------------------------------------------------

    /// @notice Pay out a default claim to the lending vault. Caller MUST be `vault`.
    /// @dev    PARTIAL-PAYOUT / NEVER-REVERT invariant: pays `min(principal + interest, totalAssets())`.
    ///         If the pool is underfunded, the shortfall is emitted as `badDebt` and the call still
    ///         succeeds. This is the explicit fix for the reference design's two DoS vectors:
    ///           - it is NOT `whenNotPaused`, so a paused insurer cannot brick defaults;
    ///           - it never reverts on underfunding, so an empty/low pool cannot brick defaults.
    ///         The lending vault wraps this in a try/catch as belt-and-suspenders, but this function
    ///         is written so that under normal conditions it simply succeeds.
    /// @param  loanId    The defaulted loan id (for the event / cross-reference).
    /// @param  principal Outstanding principal owed.
    /// @param  interest  Accrued-but-unpaid interest owed.
    /// @param  nftId     The LoanNFT id (== loanId) now held by this pool (for the event).
    /// @return amountPaid Stablecoin actually transferred to the vault.
    function processClaim(uint256 loanId, uint256 principal, uint256 interest, uint256 nftId)
        external
        nonReentrant
        returns (uint256 amountPaid)
    {
        if (msg.sender != vault) revert OnlyVault();

        uint256 owed = principal + interest;
        uint256 available = totalAssets();
        amountPaid = owed <= available ? owed : available;
        uint256 badDebt = owed - amountPaid;

        if (amountPaid > 0) {
            IERC20(asset()).safeTransfer(vault, amountPaid);
        }

        emit ClaimPaid(loanId, nftId, principal, interest, amountPaid, badDebt);
    }

    // ---------------------------------------------------------------------
    // Cover-ratio view (consumed by the vault's borrow gate)
    // ---------------------------------------------------------------------

    /// @notice Coverage of the lending vault's outstanding principal by this pool's reserves, in bps.
    /// @dev    `type(uint256).max` when there is nothing outstanding (infinite coverage). Otherwise
    ///         `totalAssets() * 10_000 / totalOutstanding`. The vault gates borrows on this being
    ///         >= its `minCoverRatioBps`.
    ///
    ///         BEST-EFFORT LIVENESS SIGNAL, NOT A HARD GUARANTEE. This reads the insurer's raw
    ///         `totalAssets()` (fungible reserves), which COVER LPs can still withdraw once the
    ///         `redeemCooldown` has elapsed — the pool does NOT lock reserves per outstanding loan
    ///         (that over-engineering is intentionally avoided). The cooldown's only job is to block
    ///         the ATOMIC / flash-loan version of the bypass — depositing cover, letting a borrow pass
    ///         this gate, then redeeming 100% back in the same tx/block to originate against
    ///         effectively-zero committed reserves. With the cooldown that round-trip reverts at the
    ///         redeem step, so the gate raises the cost of under-reserved origination and removes the
    ///         atomic exploit, but it cannot promise perpetual cover for any individual loan.
    function coverRatio(uint256 totalOutstanding) external view returns (uint256) {
        if (totalOutstanding == 0) return type(uint256).max;
        return (totalAssets() * BPS) / totalOutstanding;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Set the lending vault that may call `processClaim`. Owner-only, non-zero.
    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        emit VaultUpdated(vault, newVault);
        vault = newVault;
    }

    /// @notice Set the redeem/withdraw cooldown. Owner-only, bounded by `MAX_REDEEM_COOLDOWN` (7 days)
    ///         so the owner can never lock COVER LPs out indefinitely. A value of 0 disables the gate.
    function setRedeemCooldown(uint256 newCooldown) external onlyOwner {
        if (newCooldown > MAX_REDEEM_COOLDOWN) revert CooldownTooLong();
        emit RedeemCooldownUpdated(redeemCooldown, newCooldown);
        redeemCooldown = newCooldown;
    }

    /// @notice Pause NEW deposits/mints (emergency). Does NOT affect claims or LP withdrawals.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume deposits/mints.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // ERC-721 receiver — accept the defaulted LoanNFT moved here on default
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
