// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { KreditoVault } from "../../contracts/lendsignal/KreditoVault.sol";
import { MockERC20 } from "../../contracts/lendsignal/mocks/MockERC20.sol";

contract KreditoVaultTest is Test {
    MockERC20 internal usdc;
    KreditoVault internal vault;

    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant ROGUE_PK = 0xBEEF;
    address internal issuer;
    address internal rogue;

    address internal borrower = address(0xB0B);
    address internal lp = address(0x11D);
    address internal operator = address(0x09E);
    address internal receiver = address(0xCAFE);

    uint256 internal constant UNIT = 1e6; // 6-decimal asset
    uint256 internal constant SEED = 1_000_000 * UNIT;
    uint256 internal constant LOAN = 10_000 * UNIT;

    /// @dev Vault uses `_decimalsOffset() = 6` (inflation-attack hardening), so the share token has
    ///      6 more decimals than the asset and the first deposit mints `assets * 10**6` shares.
    ///      Expected raw share amounts in assertions are scaled by this factor.
    uint256 internal constant SHARE_OFFSET = 1e6;
    uint256 internal constant SEED_SHARES = SEED * SHARE_OFFSET;

    // Locally recomputed EIP-712 constants — MUST match the contract & the viem signer.
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 internal constant CREDIT_ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)"
    );
    bytes32 internal localDomainSeparator;

    // ERC-7540 RedeemRequest event mirror (for expectEmit).
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );
    event RedeemRequestCancelled(address indexed controller, address indexed receiver, uint256 shares);

    function setUp() public {
        vm.warp(1_000_000);
        issuer = vm.addr(ISSUER_PK);
        rogue = vm.addr(ROGUE_PK);

        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        vault = new KreditoVault(IERC20(address(usdc)), issuer);

        localDomainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256(bytes("Kredito")), keccak256(bytes("1")), block.chainid)
        );

        // Seed liquidity through the ERC-4626 deposit path (this test contract is the first LP).
        usdc.mint(address(this), SEED);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(SEED, address(this));
    }

    // ---------------------------------------------------------------------
    // EIP-712 helpers (mirror the contract / viem signer byte-for-byte)
    // ---------------------------------------------------------------------

    function _att(uint256 score, uint8 riskTier, uint256 expiresAt)
        internal
        view
        returns (KreditoVault.CreditAttestation memory)
    {
        return KreditoVault.CreditAttestation({
            borrower: borrower,
            score: score,
            riskTier: riskTier,
            evidenceDigest: keccak256("evidence"),
            issuedAt: block.timestamp,
            expiresAt: expiresAt
        });
    }

    function _digest(KreditoVault.CreditAttestation memory att) internal view returns (bytes32) {
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
        return keccak256(abi.encodePacked("\x19\x01", localDomainSeparator, structHash));
    }

    function _sign(uint256 pk, KreditoVault.CreditAttestation memory att) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(att));
        return abi.encodePacked(r, s, v);
    }

    function _borrow(uint256 amount) internal returns (uint256 loanId) {
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.prank(borrower);
        loanId = vault.borrow(att, sig, amount);
    }

    function _seedLp(address who, uint256 amount) internal returns (uint256 shares) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        shares = vault.deposit(amount, who);
        vm.stopPrank();
    }

    // =====================================================================
    // EIP-712 parity — confirm byte-for-byte identical to KreditoCreditVault
    // =====================================================================

    function test_EIP712_DomainAndTypehashesUnchanged() public view {
        assertEq(vault.domainSeparator(), localDomainSeparator, "domain separator mismatch");
        assertEq(vault.EIP712_DOMAIN_TYPEHASH(), EIP712_DOMAIN_TYPEHASH, "domain typehash mismatch");
        assertEq(vault.CREDIT_ATTESTATION_TYPEHASH(), CREDIT_ATTESTATION_TYPEHASH, "att typehash mismatch");
        assertEq(keccak256(bytes(vault.DOMAIN_NAME())), keccak256(bytes("Kredito")), "name != Kredito");
        assertEq(keccak256(bytes(vault.DOMAIN_VERSION())), keccak256(bytes("1")), "version != 1");
    }

    function test_EIP712_HashAndRecoverMatch() public view {
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        assertEq(vault.hashAttestation(att), _digest(att), "digest mismatch");
        bytes memory sig = _sign(ISSUER_PK, att);
        assertEq(vault.recoverIssuer(att, sig), issuer, "recovered signer != issuer");
    }

    // =====================================================================
    // ERC-4626 share / asset accounting
    // =====================================================================

    function test_ERC4626_DepositMintsShares1to1FirstDeposit() public view {
        // With `_decimalsOffset() = 6`, the first deposit mints `assets * 10**6` shares and the
        // share token carries 6 + 6 = 12 decimals. Asset accounting is unchanged.
        assertEq(vault.balanceOf(address(this)), SEED_SHARES, "shares minted (offset-scaled)");
        assertEq(vault.totalSupply(), SEED_SHARES, "total supply");
        assertEq(vault.totalAssets(), SEED, "total assets");
        assertEq(vault.asset(), address(usdc), "asset");
        assertEq(vault.decimals(), 12, "vault shares = asset decimals + 6 offset");
    }

    function test_ERC4626_Mint() public {
        uint256 wantShares = 100 * UNIT;
        uint256 assetsIn = vault.previewMint(wantShares);

        usdc.mint(lp, assetsIn);
        vm.startPrank(lp);
        usdc.approve(address(vault), type(uint256).max);
        uint256 assetsUsed = vault.mint(wantShares, lp);
        vm.stopPrank();

        assertEq(vault.balanceOf(lp), wantShares, "exactly wantShares minted");
        assertEq(assetsUsed, assetsIn, "assets used == previewMint");
    }

    function test_ERC4626_TotalAssetsIncludesLentOutPrincipal() public {
        _borrow(LOAN);
        // idle dropped by LOAN, but totalAssets must still be SEED (idle + outstanding).
        assertEq(usdc.balanceOf(address(vault)), SEED - LOAN, "idle dropped");
        assertEq(vault.totalOutstanding(), LOAN, "outstanding tracked");
        assertEq(vault.totalAssets(), SEED, "totalAssets includes lent-out principal");
    }

    function test_ERC4626_ConvertRoundTrip() public view {
        uint256 shares = vault.convertToShares(123_456 * UNIT);
        uint256 assets = vault.convertToAssets(shares);
        assertApproxEqAbs(assets, 123_456 * UNIT, 2, "convert round-trip");
    }

    function test_ERC4626_SharePriceRisesAfterInterest() public {
        // Simulate interest: someone donates extra asset to the vault (e.g. repay > principal).
        // Price the LP's full share block (UNIT shares is too small to resolve a price delta with
        // the 6-decimal virtual offset, since UNIT shares ~ 1 micro-unit of asset).
        uint256 block_ = vault.balanceOf(address(this));
        uint256 assetsBefore = vault.convertToAssets(block_);
        usdc.mint(address(vault), 100_000 * UNIT); // yield accrues to all shareholders
        uint256 assetsAfter = vault.convertToAssets(block_);
        assertGt(assetsAfter, assetsBefore, "share price rose with yield");
    }

    function test_ERC4626_MultipleLPsProRata() public {
        // Second LP deposits the same amount; total supply doubles, each holds half pro-rata.
        uint256 sharesLp = _seedLp(lp, SEED);
        assertApproxEqAbs(sharesLp, SEED_SHARES, 2 * SHARE_OFFSET, "second LP gets ~1:1 (price still ~1)");
        assertEq(vault.totalSupply(), SEED_SHARES + sharesLp, "supply summed");
        // Each LP's claim on assets is pro-rata.
        uint256 thisAssets = vault.convertToAssets(vault.balanceOf(address(this)));
        uint256 lpAssets = vault.convertToAssets(vault.balanceOf(lp));
        assertApproxEqAbs(thisAssets, lpAssets, 4, "pro-rata claims roughly equal");
    }

    function test_ERC4626_PreviewDepositMintDoNotRevert() public view {
        // MUST NOT revert (deposits are synchronous).
        assertGt(vault.previewDeposit(LOAN), 0, "previewDeposit works");
        assertGt(vault.previewMint(LOAN), 0, "previewMint works");
        assertEq(vault.maxDeposit(address(this)), type(uint256).max, "maxDeposit unbounded");
        assertEq(vault.maxMint(address(this)), type(uint256).max, "maxMint unbounded");
    }

    function test_ERC4626_PreviewRedeemWithdrawRevert() public {
        vm.expectRevert(KreditoVault.PreviewNotSupported.selector);
        vault.previewRedeem(UNIT);
        vm.expectRevert(KreditoVault.PreviewNotSupported.selector);
        vault.previewWithdraw(UNIT);
    }

    // =====================================================================
    // ERC-7540 async redeem lifecycle
    // =====================================================================

    function test_RequestRedeem_EscrowsSharesIncrementsPendingEmits() public {
        uint256 shares = 50_000 * UNIT;

        vm.expectEmit(true, true, true, true, address(vault));
        emit RedeemRequest(address(this), address(this), 0, address(this), shares);

        uint256 reqId = vault.requestRedeem(shares, address(this), address(this));
        assertEq(reqId, 0, "requestId must be 0");

        // Shares escrowed in the vault (transferred, NOT burned).
        assertEq(vault.balanceOf(address(vault)), shares, "shares escrowed in vault");
        assertEq(vault.balanceOf(address(this)), SEED_SHARES - shares, "owner shares reduced");
        assertEq(vault.totalSupply(), SEED_SHARES, "supply unchanged (not burned yet)");

        // Pending reflects, claimable does not.
        assertEq(vault.pendingRedeemRequest(0, address(this)), shares, "pending set");
        assertEq(vault.claimableRedeemRequest(0, address(this)), 0, "nothing claimable yet");
    }

    function test_PendingAndClaimable_CallerInvariantAndNoRevert() public {
        uint256 shares = 10_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));

        // Caller-invariant: same value regardless of msg.sender.
        vm.prank(rogue);
        uint256 p1 = vault.pendingRedeemRequest(0, address(this));
        vm.prank(borrower);
        uint256 p2 = vault.pendingRedeemRequest(0, address(this));
        assertEq(p1, p2, "pending caller-invariant");
        assertEq(p1, shares, "pending value");

        // requestId argument ignored — any value returns same.
        assertEq(vault.pendingRedeemRequest(999, address(this)), shares, "requestId ignored");
        // Empty controller does not revert.
        assertEq(vault.pendingRedeemRequest(0, address(0xdead)), 0, "empty controller no revert");
    }

    function test_FulfillRedeem_MovesPendingToClaimableBurnsReservesAssets() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));

        uint256 expectedAssets = vault.convertToAssets(shares);
        uint256 supplyBefore = vault.totalSupply();

        vault.fulfillRedeem(address(this), shares);

        assertEq(vault.pendingRedeemRequest(0, address(this)), 0, "pending cleared");
        assertEq(vault.claimableRedeemRequest(0, address(this)), shares, "claimable set");
        assertEq(vault.totalSupply(), supplyBefore - shares, "escrowed shares burned");
        assertEq(vault.balanceOf(address(vault)), 0, "no escrow left");
        assertEq(vault.totalClaimableAssets(), expectedAssets, "assets reserved");
        assertEq(vault.maxRedeem(address(this)), shares, "maxRedeem = claimable shares");
        assertEq(vault.maxWithdraw(address(this)), expectedAssets, "maxWithdraw = claimable assets");
    }

    function test_FulfillRedeem_RevertsWhenIdleInsufficient() public {
        // Lend out almost everything, then request a redeem that can't be fulfilled.
        _borrow(SEED - 100 * UNIT); // idle = 100 mUSDC
        // Share-denominated request worth ~50,000 mUSDC (>> 100 mUSDC idle). Scaled by SHARE_OFFSET.
        uint256 shares = 50_000 * UNIT * SHARE_OFFSET;
        vault.requestRedeem(shares, address(this), address(this));

        // convertToAssets(shares) >> idle, so fulfill must revert.
        vm.expectRevert(KreditoVault.InsufficientLiquidity.selector);
        vault.fulfillRedeem(address(this), shares);
    }

    function test_FulfillRedeem_OnlyOwner() public {
        vault.requestRedeem(1_000 * UNIT, address(this), address(this));
        vm.prank(rogue);
        vm.expectRevert();
        vault.fulfillRedeem(address(this), 1_000 * UNIT);
    }

    function test_FulfillRedeem_RevertsWhenExceedsPending() public {
        vault.requestRedeem(1_000 * UNIT, address(this), address(this));
        vm.expectRevert(KreditoVault.InsufficientPending.selector);
        vault.fulfillRedeem(address(this), 2_000 * UNIT);
    }

    function test_Redeem_ClaimTransfersReservedAssetsClearsClaimable() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vault.fulfillRedeem(address(this), shares);
        uint256 owed = vault.maxWithdraw(address(this));

        uint256 balBefore = usdc.balanceOf(receiver);

        vm.expectEmit(true, true, true, true, address(vault));
        emit Withdraw(address(this), receiver, address(this), owed, shares);

        uint256 assets = vault.redeem(shares, receiver, address(this));

        assertEq(assets, owed, "claim returns owed assets");
        assertEq(usdc.balanceOf(receiver) - balBefore, owed, "assets delivered");
        assertEq(vault.claimableRedeemRequest(0, address(this)), 0, "claimable cleared");
        assertEq(vault.totalClaimableAssets(), 0, "reserve released");
        assertEq(vault.maxRedeem(address(this)), 0, "nothing left to claim");
    }

    function test_Withdraw_AssetDenominatedClaim() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vault.fulfillRedeem(address(this), shares);
        uint256 owed = vault.maxWithdraw(address(this));

        uint256 balBefore = usdc.balanceOf(receiver);
        uint256 burnedShares = vault.withdraw(owed, receiver, address(this));

        assertEq(burnedShares, shares, "withdraw burns the matching shares accounting");
        assertEq(usdc.balanceOf(receiver) - balBefore, owed, "assets delivered");
        assertEq(vault.totalClaimableAssets(), 0, "reserve released");
    }

    function test_Redeem_MustNotSkipClaimable_RevertsBeforeFulfill() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        // No fulfill yet -> nothing claimable -> claim reverts (can't skip the fulfill step).
        vm.expectRevert(KreditoVault.InsufficientClaimable.selector);
        vault.redeem(shares, receiver, address(this));
    }

    function test_Redeem_RevertsWhenExceedingClaimable() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vault.fulfillRedeem(address(this), shares);
        vm.expectRevert(KreditoVault.InsufficientClaimable.selector);
        vault.redeem(shares + 1, receiver, address(this));
    }

    function test_PartialFulfillThenPartialClaim() public {
        uint256 shares = 60_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));

        // Fulfill half.
        vault.fulfillRedeem(address(this), 20_000 * UNIT);
        assertEq(vault.pendingRedeemRequest(0, address(this)), 40_000 * UNIT, "remaining pending");
        assertEq(vault.claimableRedeemRequest(0, address(this)), 20_000 * UNIT, "claimable half");

        // Claim part of the claimable.
        vault.redeem(5_000 * UNIT, receiver, address(this));
        assertEq(vault.claimableRedeemRequest(0, address(this)), 15_000 * UNIT, "claimable reduced");

        // Fulfill the rest, claim the rest.
        vault.fulfillRedeem(address(this), 40_000 * UNIT);
        assertEq(vault.pendingRedeemRequest(0, address(this)), 0, "pending fully fulfilled");
        uint256 remaining = vault.maxRedeem(address(this));
        vault.redeem(remaining, receiver, address(this));
        assertEq(vault.totalClaimableAssets(), 0, "all reserves released");
    }

    // =====================================================================
    // ERC-7540 operators
    // =====================================================================

    function test_SetOperator_AndIsOperator() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit OperatorSet(address(this), operator, true);
        assertTrue(vault.setOperator(operator, true), "setOperator returns true");
        assertTrue(vault.isOperator(address(this), operator), "operator approved");

        vault.setOperator(operator, false);
        assertFalse(vault.isOperator(address(this), operator), "operator revoked");
    }

    function test_SetOperator_RevertsOnSelf() public {
        vm.expectRevert(KreditoVault.CannotOperateSelf.selector);
        vault.setOperator(address(this), true);
    }

    function test_Operator_CanRequestAndClaimOnBehalf() public {
        // LP owns shares; approves operator.
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        vm.prank(lp);
        vault.setOperator(operator, true);

        // Operator requests redeem on behalf of LP (controller = lp, owner = lp).
        vm.prank(operator);
        vault.requestRedeem(shares, lp, lp);
        assertEq(vault.pendingRedeemRequest(0, lp), shares, "pending under controller lp");

        // Owner fulfills.
        vault.fulfillRedeem(lp, shares);

        // Operator claims for the controller, sends to receiver.
        uint256 owed = vault.maxWithdraw(lp);
        uint256 balBefore = usdc.balanceOf(receiver);
        vm.prank(operator);
        vault.redeem(shares, receiver, lp);
        assertEq(usdc.balanceOf(receiver) - balBefore, owed, "operator claimed for controller");
    }

    function test_NonOperatorNonController_ClaimReverts() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vault.fulfillRedeem(address(this), shares);

        vm.prank(rogue); // not controller, not operator
        vm.expectRevert(KreditoVault.NotAuthorized.selector);
        vault.redeem(shares, receiver, address(this));
    }

    function test_RequestRedeem_ViaShareAllowance() public {
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        // LP grants ERC-20 share allowance to a relayer (not operator).
        vm.prank(lp);
        vault.approve(operator, shares);

        vm.prank(operator);
        vault.requestRedeem(shares, lp, lp); // spends allowance
        assertEq(vault.pendingRedeemRequest(0, lp), shares, "pending via allowance");
        assertEq(vault.allowance(lp, operator), 0, "allowance spent");
    }

    function test_RequestRedeem_UnauthorizedReverts() public {
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        // rogue is neither owner, operator, nor has allowance.
        vm.prank(rogue);
        vm.expectRevert(); // ERC20InsufficientAllowance from _spendAllowance
        vault.requestRedeem(shares, lp, lp);
    }

    // =====================================================================
    // ERC-165 — exact true/false set
    // =====================================================================

    function test_SupportsInterface_ExactSet() public view {
        assertTrue(vault.supportsInterface(0x01ffc9a7), "ERC-165");
        assertTrue(vault.supportsInterface(0xe3bc4e65), "operator methods");
        assertTrue(vault.supportsInterface(0x2f0a18c5), "ERC-7575");
        assertTrue(vault.supportsInterface(0x620ee8e4), "async redeem");
        assertFalse(vault.supportsInterface(0xce3bbe50), "async deposit NOT supported");
        assertFalse(vault.supportsInterface(0xffffffff), "invalid id false");
    }

    // =====================================================================
    // ERC-7575
    // =====================================================================

    function test_ERC7575_ShareIsSelf() public view {
        assertEq(vault.share(), address(vault), "share() == this");
    }

    // =====================================================================
    // Borrow side end-to-end (ported)
    // =====================================================================

    function test_Borrow_HappyPath_DisbursesAndTracksOutstanding() public {
        uint256 loanId = _borrow(LOAN);
        assertEq(usdc.balanceOf(borrower), LOAN, "borrower funded");
        assertEq(vault.idleLiquidity(), SEED - LOAN, "idle decremented");
        assertEq(vault.totalOutstanding(), LOAN, "outstanding tracked");
        assertEq(vault.totalAssets(), SEED, "totalAssets constant");
        assertEq(vault.openLoanOf(borrower), loanId, "open loan set");

        KreditoVault.Loan memory loan = vault.getLoan(loanId);
        assertTrue(vault.attestationUsed(loan.attestationDigest), "attestation burned");
    }

    function test_Borrow_ReplayGuardReverts() public {
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.startPrank(borrower);
        uint256 loanId = vault.borrow(att, sig, LOAN);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();

        vm.prank(borrower);
        vm.expectRevert(KreditoVault.AttestationAlreadyUsed.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_IneligibleReverts() public {
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ROGUE_PK, att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.NotEligible.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_ExpiredReverts() public {
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.warp(att.expiresAt + 1);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.NotEligible.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_BelowMinScoreReverts() public {
        KreditoVault.CreditAttestation memory att = _att(749, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.NotEligible.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_CannotExceedIdleWhenAssetsReservedForClaims() public {
        // Reserve part of liquidity for a fulfilled redemption, then borrow must respect idle.
        uint256 shares = 200_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        uint256 reserved = vault.convertToAssets(shares);
        vault.fulfillRedeem(address(this), shares);

        assertEq(vault.totalClaimableAssets(), reserved, "reserved");
        assertEq(vault.idleLiquidity(), usdc.balanceOf(address(vault)) - reserved, "idle excludes reserve");

        // Borrowing exactly idle works; one more wei reverts.
        uint256 idle = vault.idleLiquidity();
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.InsufficientLiquidity.selector);
        vault.borrow(att, sig, idle + 1);
    }

    function test_Repay_FreesLiquidity() public {
        uint256 loanId = _borrow(LOAN);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();
        assertEq(vault.totalOutstanding(), 0, "nothing outstanding");
        assertEq(vault.idleLiquidity(), SEED, "liquidity restored");
        assertEq(vault.openLoanOf(borrower), 0, "open loan cleared");
    }

    // =====================================================================
    // INTERPLAY: the proof the async model does real work
    // =====================================================================

    function test_Interplay_BorrowDrainsLiquidity_RedeemBlocked_ThenRepaidThenFulfilled() public {
        // 1. LP capital is already seeded (this contract holds SEED shares).
        // 2. Borrower borrows MOST of the liquidity.
        uint256 borrowAmt = SEED - 10 * UNIT; // leave 10 mUSDC idle
        uint256 loanId = _borrow(borrowAmt);
        assertEq(vault.idleLiquidity(), 10 * UNIT, "almost drained");

        // 3. LP requests a large redeem (~500,000 mUSDC of value; share amount scaled by SHARE_OFFSET).
        uint256 shares = 500_000 * UNIT * SHARE_OFFSET;
        vault.requestRedeem(shares, address(this), address(this));
        uint256 owed = vault.convertToAssets(shares);
        assertGt(owed, vault.idleLiquidity(), "owed exceeds idle");

        // 4. Fulfill REVERTS — no idle capital to honor it.
        vm.expectRevert(KreditoVault.InsufficientLiquidity.selector);
        vault.fulfillRedeem(address(this), shares);

        // 5. Borrower repays — idle liquidity rises back.
        usdc.mint(borrower, borrowAmt); // borrower needs principal to repay
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();
        assertGe(vault.idleLiquidity(), owed, "idle now covers the redeem");

        // 6. Fulfill now SUCCEEDS.
        vault.fulfillRedeem(address(this), shares);
        assertEq(vault.claimableRedeemRequest(0, address(this)), shares, "now claimable");

        // 7. LP claims the locked-rate assets.
        uint256 balBefore = usdc.balanceOf(receiver);
        vault.redeem(shares, receiver, address(this));
        assertEq(usdc.balanceOf(receiver) - balBefore, owed, "claimed assets at locked rate");
        assertEq(vault.totalClaimableAssets(), 0, "reserve cleared");
    }

    // =====================================================================
    // Fuzz
    // =====================================================================

    function testFuzz_DepositMintsProportionalShares(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 * UNIT);
        uint256 expectedShares = vault.previewDeposit(amount);
        usdc.mint(lp, amount);
        vm.startPrank(lp);
        usdc.approve(address(vault), type(uint256).max);
        uint256 got = vault.deposit(amount, lp);
        vm.stopPrank();
        assertEq(got, expectedShares, "deposit shares == previewDeposit");
        assertEq(vault.balanceOf(lp), expectedShares, "shares credited");
    }

    function testFuzz_RequestFulfillClaim_Conserves(uint256 shares) public {
        shares = bound(shares, 1, SEED); // can't request more than we hold
        vault.requestRedeem(shares, address(this), address(this));
        assertEq(vault.pendingRedeemRequest(0, address(this)), shares, "pending");

        uint256 owed = vault.convertToAssets(shares);
        vm.assume(owed <= vault.idleLiquidity()); // only fulfill what idle covers
        vault.fulfillRedeem(address(this), shares);

        uint256 balBefore = usdc.balanceOf(receiver);
        vault.redeem(shares, receiver, address(this));
        assertEq(usdc.balanceOf(receiver) - balBefore, owed, "claim conserves owed assets");
        assertEq(vault.totalClaimableAssets(), 0, "no leftover reserve");
    }

    function testFuzz_Borrow_WithinIdleLiquidity(uint256 amount) public {
        amount = bound(amount, 1, SEED);
        KreditoVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.prank(borrower);
        vault.borrow(att, sig, amount);
        assertEq(usdc.balanceOf(borrower), amount, "funded amount");
        assertEq(vault.idleLiquidity(), SEED - amount, "idle decremented");
        assertEq(vault.totalAssets(), SEED, "totalAssets invariant");
    }

    // =====================================================================
    // REGRESSION — CRITICAL: totalAssets() must NOT double-count reserved
    // (claimable) assets. A depositor entering while a fulfilled-but-unclaimed
    // redemption exists must still get ~proportional shares; no LP is robbed.
    // =====================================================================

    function test_Regression_FulfilledRedeemDoesNotInflateSharePrice_NoLPRobbed() public {
        // Fresh vault with NO pre-seed so the numbers are clean and auditable.
        MockERC20 token = new MockERC20("Mock USD Coin", "mUSDC", 6);
        KreditoVault v = new KreditoVault(IERC20(address(token)), issuer);

        address bob = address(0xB0B0);
        address alice = address(0xA11C0);
        address carol = address(0xCAA01);
        uint256 amt = 1_000 * UNIT;

        // Bob and Alice each deposit 1000.
        _depositInto(v, token, bob, amt);
        _depositInto(v, token, alice, amt);
        assertEq(v.totalAssets(), 2 * amt, "backing == 2000 before any redeem");

        // Alice requests redeem of ALL her shares, then owner fulfills (rate locked, shares burned,
        // assets reserved). Her 1000 of assets are now reserved in totalClaimableAssets but still
        // physically sit in the vault's token balance.
        uint256 aliceShares = v.balanceOf(alice);
        vm.prank(alice);
        v.requestRedeem(aliceShares, alice, alice);
        uint256 aliceOwed = v.convertToAssets(aliceShares);
        v.fulfillRedeem(alice, aliceShares);

        assertEq(v.totalClaimableAssets(), aliceOwed, "Alice's assets reserved");
        // CRITICAL ASSERTION: backing for the LIVE supply must EXCLUDE the reserved assets.
        // Live supply is now just Bob's shares; backing must equal Bob's ~1000, NOT 2000.
        assertApproxEqAbs(v.totalAssets(), amt, 1, "totalAssets excludes reserved -> ~1000, not inflated");

        // Carol now deposits 1000. With the bug she'd get ~half the shares (price inflated 2x);
        // with the fix she must get ~1:1 with Bob.
        uint256 carolShares = _depositInto(v, token, carol, amt);
        uint256 bobShares = v.balanceOf(bob);
        assertApproxEqRel(carolShares, bobShares, 1e12, "Carol gets ~same shares as Bob (1:1), not half");

        // Carol's claim on assets must be ~her principal, not 1 wei.
        uint256 carolClaim = v.convertToAssets(carolShares);
        assertApproxEqRel(carolClaim, amt, 1e12, "Carol's share value ~= her 1000 principal");

        // --- Solvency: every LP can be made whole and claims never exceed assets. ---
        // Alice claims her locked-rate reserve.
        vm.prank(alice);
        uint256 aliceGot = v.redeem(aliceShares, alice, alice);
        assertEq(aliceGot, aliceOwed, "Alice claimed her locked 1000");
        assertEq(token.balanceOf(alice), aliceOwed, "Alice received ~1000");

        // Bob and Carol redeem via the async flow. Their combined live claim must be <= remaining
        // assets (vault stays solvent; nobody is robbed).
        uint256 bobOwed = _fullAsyncExit(v, bob);
        uint256 carolOwed = _fullAsyncExit(v, carol);

        assertApproxEqRel(bobOwed, amt, 1e12, "Bob exits with ~1000 (not robbed by Carol's entry)");
        assertApproxEqRel(carolOwed, amt, 1e12, "Carol exits with ~1000 (not 1 wei)");

        // Conservation: total paid out across all three LPs <= total deposited (3000), and the
        // residual dust left in the vault is non-negative (no over-payment / insolvency).
        uint256 totalPaid = aliceGot + bobOwed + carolOwed;
        assertLe(totalPaid, 3 * amt, "sum of claims <= total deposited (solvent)");
        assertEq(v.totalClaimableAssets(), 0, "all reserves released");
        // No shares left implies all backing accounted for; residual is rounding dust only.
        assertEq(v.totalSupply(), 0, "all live shares exited");
        assertLe(3 * amt - totalPaid, 10, "only rounding dust unredeemed (<=10 wei)");
    }

    /// @dev Deposit `amount` into vault `v` as `who`, returning minted shares.
    function _depositInto(KreditoVault v, MockERC20 token, address who, uint256 amount)
        internal
        returns (uint256 shares)
    {
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(v), type(uint256).max);
        shares = v.deposit(amount, who);
        vm.stopPrank();
    }

    /// @dev Run the full async exit for `who` as both owner and controller: request all their shares,
    ///      owner fulfills, then `who` redeems. Returns assets received.
    function _fullAsyncExit(KreditoVault v, address who) internal returns (uint256 got) {
        uint256 sh = v.balanceOf(who);
        if (sh == 0) return 0;
        vm.prank(who);
        v.requestRedeem(sh, who, who);
        v.fulfillRedeem(who, sh);
        vm.prank(who);
        got = v.redeem(sh, who, who);
    }

    // =====================================================================
    // REGRESSION — HIGH: first-depositor / inflation attack mitigated by the
    // 6-decimal virtual offset (+ deploy seed). A 1-wei deposit followed by a
    // large direct donation must NOT let the attacker steal the victim's deposit.
    // =====================================================================

    function test_Regression_InflationAttack_VictimNotRobbed() public {
        MockERC20 token = new MockERC20("Mock USD Coin", "mUSDC", 6);
        KreditoVault v = new KreditoVault(IERC20(address(token)), issuer);

        address attacker = address(0xA77ACC);
        address victim = address(0x71C711);
        uint256 victimDeposit = 10_000 * UNIT;
        uint256 donation = 100_000 * UNIT; // attacker tries to inflate price via direct transfer

        // 1. Attacker deposits 1 wei (gets 1 * 10**offset shares thanks to the virtual offset).
        token.mint(attacker, 1);
        vm.startPrank(attacker);
        token.approve(address(v), type(uint256).max);
        uint256 attackerShares = v.deposit(1, attacker);
        vm.stopPrank();
        assertGt(attackerShares, 0, "attacker holds offset-scaled shares");

        // 2. Attacker donates a large amount directly to the vault to inflate the share price.
        token.mint(attacker, donation);
        vm.prank(attacker);
        token.transfer(address(v), donation);

        // 3. Victim deposits. With offset=0 this could round to 0 shares (classic theft). With
        //    offset=6 the victim still mints a meaningful, near-proportional share amount.
        uint256 victimShares = _depositInto(v, token, victim, victimDeposit);
        assertGt(victimShares, 0, "victim must receive non-zero shares");

        // 4. The victim's claim on assets must be ~their deposit (they are not materially robbed).
        //    Attacker can at most capture rounding dust, not the victim's principal.
        uint256 victimClaim = v.convertToAssets(victimShares);
        assertApproxEqRel(victimClaim, victimDeposit, 1e15, "victim claim ~= deposit (<=0.1% loss)");

        // 5. Attacker's claim cannot exceed what they actually contributed (1 wei + donation); the
        //    point is they cannot also siphon the victim's principal.
        uint256 attackerClaim = v.convertToAssets(v.balanceOf(attacker));
        assertLe(attackerClaim, 1 + donation + 1, "attacker cannot claim more than they put in");
    }

    // =====================================================================
    // REGRESSION — MEDIUM: cancelRedeemRequest un-escrows PENDING shares only.
    // =====================================================================

    function test_CancelRedeemRequest_ReturnsSharesAndZeroesPending() public {
        uint256 shares = 50_000 * UNIT;
        uint256 balBefore = vault.balanceOf(address(this));
        vault.requestRedeem(shares, address(this), address(this));
        assertEq(vault.pendingRedeemRequest(0, address(this)), shares, "pending set");
        assertEq(vault.balanceOf(address(this)), balBefore - shares, "shares escrowed");

        vm.expectEmit(true, true, false, true, address(vault));
        emit RedeemRequestCancelled(address(this), address(this), shares);
        vault.cancelRedeemRequest(shares, address(this));

        assertEq(vault.pendingRedeemRequest(0, address(this)), 0, "pending zeroed");
        assertEq(vault.balanceOf(address(this)), balBefore, "shares returned to controller");
        assertEq(vault.balanceOf(address(vault)), 0, "no escrow left in vault");
    }

    function test_CancelRedeemRequest_CannotCancelMoreThanPending() public {
        uint256 shares = 10_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vm.expectRevert(KreditoVault.InsufficientPending.selector);
        vault.cancelRedeemRequest(shares + 1, address(this));
    }

    function test_CancelRedeemRequest_CannotCancelFulfilledClaimable() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vault.fulfillRedeem(address(this), shares); // pending -> claimable (burned)
        // Pending is now 0; the shares are claimable, not cancelable.
        vm.expectRevert(KreditoVault.InsufficientPending.selector);
        vault.cancelRedeemRequest(shares, address(this));
        // Claimable is untouched.
        assertEq(vault.claimableRedeemRequest(0, address(this)), shares, "claimable intact");
    }

    function test_CancelRedeemRequest_OperatorCanCancelForController() public {
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        vm.prank(lp);
        vault.setOperator(operator, true);
        vm.prank(lp);
        vault.requestRedeem(shares, lp, lp);

        vm.prank(operator);
        vault.cancelRedeemRequest(shares, lp);
        assertEq(vault.pendingRedeemRequest(0, lp), 0, "pending zeroed by operator");
        assertEq(vault.balanceOf(lp), shares, "shares returned to controller lp");
    }

    function test_CancelRedeemRequest_NonOperatorNonControllerReverts() public {
        uint256 shares = 50_000 * UNIT;
        vault.requestRedeem(shares, address(this), address(this));
        vm.prank(rogue);
        vm.expectRevert(KreditoVault.NotAuthorized.selector);
        vault.cancelRedeemRequest(shares, address(this));
    }

    // =====================================================================
    // REGRESSION — MEDIUM: requestRedeem allowance fallback is a confused
    // deputy unless controller == owner is enforced.
    // =====================================================================

    function test_RequestRedeem_AllowanceFallback_ControllerMustEqualOwner() public {
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        // LP grants a bare ERC-20 share allowance to a relayer (NOT an operator).
        vm.prank(lp);
        vault.approve(operator, shares);

        // Attacker-chosen controller (!= owner) must REVERT — no confused deputy.
        vm.prank(operator);
        vm.expectRevert(KreditoVault.NotAuthorized.selector);
        vault.requestRedeem(shares, operator, lp); // controller=operator, owner=lp

        // controller == owner is the only allowed allowance-path routing, and it works.
        vm.prank(operator);
        vault.requestRedeem(shares, lp, lp);
        assertEq(vault.pendingRedeemRequest(0, lp), shares, "allowance path works when controller==owner");
        assertEq(vault.allowance(lp, operator), 0, "allowance spent");
    }

    function test_RequestRedeem_OperatorCanStillRouteToAnyController() public {
        // Operator path is unaffected: an approved operator may set an arbitrary controller.
        uint256 shares = _seedLp(lp, 100_000 * UNIT);
        vm.prank(lp);
        vault.setOperator(operator, true);
        address customController = address(0xC0117);

        vm.prank(operator);
        vault.requestRedeem(shares, customController, lp);
        assertEq(vault.pendingRedeemRequest(0, customController), shares, "operator routed to custom controller");
    }

    // =====================================================================
    // REGRESSION — LOW: Ownable2Step + setMinScore upper bound.
    // =====================================================================

    function test_Ownable2Step_TwoStepTransfer() public {
        address newOwner = address(0x0117E2);
        // Step 1: current owner (this test contract) proposes; ownership does NOT change yet.
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), address(this), "owner unchanged until accepted");
        assertEq(vault.pendingOwner(), newOwner, "pending owner set");

        // A non-pending account cannot accept.
        vm.prank(rogue);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rogue));
        vault.acceptOwnership();

        // Step 2: the pending owner accepts -> ownership transfers.
        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner, "ownership transferred after accept");
        assertEq(vault.pendingOwner(), address(0), "pending cleared");
    }

    function test_SetMinScore_BoundedByMax() public {
        // Within bounds works.
        vault.setMinScore(1000);
        assertEq(vault.minScore(), 1000, "max allowed");
        // Zero reverts.
        vm.expectRevert(KreditoVault.InvalidMinScore.selector);
        vault.setMinScore(0);
        // Above MAX_MIN_SCORE reverts (would silently freeze borrowing otherwise).
        vm.expectRevert(KreditoVault.InvalidMinScore.selector);
        vault.setMinScore(1001);
    }
}
