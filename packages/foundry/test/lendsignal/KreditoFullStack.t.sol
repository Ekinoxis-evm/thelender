// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { KreditoVault } from "../../contracts/lendsignal/KreditoVault.sol";
import { KreditoInsurancePool } from "../../contracts/lendsignal/KreditoInsurancePool.sol";
import { MockERC20 } from "../../contracts/lendsignal/mocks/MockERC20.sol";

/// @title KreditoFullStack tests
/// @notice End-to-end coverage of the installment-lending + insurance integration:
///         amortization (no soft-lock), on-time/grace/overdue payment paths, protocol fee → insurer,
///         cover-ratio + exposure-cap + buffer gates, the three default scenarios (full / partial /
///         paused insurer), ERC-7540 redeem after loans, and the share-price-not-inflated regression.
///         Loans are tracked by the vault's own loan mapping; the borrower's <label>.kredito.eth ENS
///         identity is the credential (no loan NFT).
contract KreditoFullStackTest is Test {
    MockERC20 internal usdc;
    KreditoVault internal vault;
    KreditoInsurancePool internal insurance;

    uint256 internal constant ISSUER_PK = 0xA11CE;
    address internal issuer;

    address internal borrower = address(0xB0B);
    address internal borrower2 = address(0xB0B2);
    address internal coverLp = address(0xC0FE);
    address internal keeper = address(0x4EE9E5);

    uint256 internal constant UNIT = 1e6; // 6-decimal asset
    uint256 internal constant SEED = 1_000_000 * UNIT; // vault LP liquidity
    uint256 internal constant COVER_SEED = 500_000 * UNIT; // insurance reserves
    uint256 internal constant LOAN = 12_000 * UNIT; // divides evenly by 12

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 internal constant CREDIT_ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)"
    );
    bytes32 internal localDomainSeparator;

    function setUp() public {
        vm.warp(1_000_000);
        issuer = vm.addr(ISSUER_PK);

        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        vault = new KreditoVault(IERC20(address(usdc)), issuer);
        insurance = new KreditoInsurancePool(IERC20(address(usdc)));

        // Wire the stack.
        vault.setInsurancePool(address(insurance));
        insurance.setVault(address(vault));

        // Permissive-but-realistic risk params for most tests; individual tests override as needed.
        // buffer 10%, exposure cap 50% (so a single borrower can take meaningful loans), minCover 20%,
        // protocol fee 20%.
        vault.setRiskParams(1000, 5000, 2000, 2000);

        localDomainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256(bytes("Kredito")), keccak256(bytes("1")), block.chainid)
        );

        // Seed the lending vault (this contract is the LP).
        usdc.mint(address(this), SEED);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(SEED, address(this));

        // Seed the insurance pool.
        usdc.mint(coverLp, COVER_SEED);
        vm.startPrank(coverLp);
        usdc.approve(address(insurance), type(uint256).max);
        insurance.deposit(COVER_SEED, coverLp);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // EIP-712 helpers (byte-for-byte mirror of the vault / viem signer)
    // ---------------------------------------------------------------------

    /// @dev Monotonic nonce so each minted attestation has a unique digest (no replay-guard collision
    ///      when a test borrows multiple times for the same address).
    uint256 internal attNonce;

    function _att(address who, uint256 score, uint8 riskTier, uint256 expiresAt)
        internal
        returns (KreditoVault.CreditAttestation memory)
    {
        return KreditoVault.CreditAttestation({
            borrower: who,
            score: score,
            riskTier: riskTier,
            evidenceDigest: keccak256(abi.encodePacked("evidence", who, attNonce++)),
            issuedAt: block.timestamp,
            expiresAt: expiresAt
        });
    }

    function _sign(KreditoVault.CreditAttestation memory att) internal view returns (bytes memory) {
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", localDomainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ISSUER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Originate a loan for `who` with `riskTier` (default low=2), long-lived attestation.
    function _borrow(address who, uint256 amount, uint256 termMonths, uint8 riskTier)
        internal
        returns (uint256 loanId)
    {
        KreditoVault.CreditAttestation memory att = _att(who, 800, riskTier, block.timestamp + 3650 days);
        bytes memory sig = _sign(att);
        vm.prank(who);
        loanId = vault.borrow(att, sig, amount, termMonths);
    }

    function _borrow(address who, uint256 amount, uint256 termMonths) internal returns (uint256) {
        return _borrow(who, amount, termMonths, 2);
    }

    /// @dev Pay one installment on time (warp to due date) as the loan's borrower.
    function _payOnTime(address who, uint256 loanId) internal {
        usdc.mint(who, vault.getLoan(loanId).originalPrincipal * 2);
        vm.warp(vault.getLoan(loanId).dueDate);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.makePayment(loanId);
        vm.stopPrank();
    }

    // =====================================================================
    // 1. Amortization: full repayment in EXACTLY termMonths, even at high rate
    // =====================================================================

    function test_Amortization_FullyRepaysInExactlyTermMonths() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        usdc.mint(borrower, LOAN * 2); // cover principal + interest
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);

        uint256 payments;
        while (vault.getLoan(loanId).status != KreditoVault.LoanStatus.Repaid) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vault.makePayment(loanId);
            payments++;
            require(payments <= 12, "soft-lock: more than termMonths payments");
        }
        vm.stopPrank();

        assertEq(payments, 12, "exactly termMonths installments");
        assertEq(vault.getLoan(loanId).principal, 0, "principal fully amortized");
        assertEq(vault.totalOutstanding(), 0, "nothing outstanding");
        assertEq(vault.activePrincipalByBorrower(borrower), 0, "exposure cleared");
    }

    /// @dev The reference design's soft-lock: a high rate could make interest >= a trusted
    ///      `monthlyPayment` so principal never moved. We compute principal on-chain, so even a
    ///      near-max rate still amortizes in exactly termMonths.
    function test_Amortization_NoSoftLockAtHighRate() public {
        // Set tier-1 (low risk -> via riskTier 2) to a very high 90% annual rate.
        vault.setRateTier(1, 9000);
        uint256 loanId = _borrow(borrower, LOAN, 6, 2);

        usdc.mint(borrower, LOAN * 3); // plenty for principal + heavy interest
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        uint256 payments;
        while (vault.getLoan(loanId).status != KreditoVault.LoanStatus.Repaid) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vault.makePayment(loanId);
            payments++;
            require(payments <= 6, "soft-lock at high rate");
        }
        vm.stopPrank();
        assertEq(payments, 6, "amortizes in exactly 6 even at 90% APR");
    }

    function test_Amortization_FinalInstallmentClearsRemainder() public {
        // 10001 units over 3 months: 10001/3 = 3333 per installment, last clears the +2 remainder.
        uint256 amount = 10_001 * UNIT;
        uint256 loanId = _borrow(borrower, amount, 6); // term 6 but we check per-installment math
        KreditoVault.Loan memory loan = vault.getLoan(loanId);
        assertEq(loan.principalPerInstallment, amount / 6, "equal-principal per installment");

        usdc.mint(borrower, amount * 2);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        for (uint256 i; i < 6; i++) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vault.makePayment(loanId);
        }
        vm.stopPrank();
        assertEq(vault.getLoan(loanId).principal, 0, "remainder cleared by final installment");
    }

    // =====================================================================
    // 2. Payment timing: on-time vs grace+late-fee vs past-grace
    // =====================================================================

    function test_Payment_OnTime_NoLateFee() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 interest = (l.principal * l.annualRateBps) / (10_000 * 12);
        uint256 expected = l.principalPerInstallment + interest;

        usdc.mint(borrower, expected);
        vm.warp(l.dueDate); // exactly on time
        uint256 balBefore = usdc.balanceOf(borrower);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.makePayment(loanId);
        vm.stopPrank();
        assertEq(balBefore - usdc.balanceOf(borrower), expected, "paid exactly base, no late fee");
        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Active), "still Active");
    }

    function test_Payment_WithinGrace_ChargesLateFeeAndSetsGrace() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 interest = (l.principal * l.annualRateBps) / (10_000 * 12);
        uint256 base = l.principalPerInstallment + interest;
        uint256 lateFee = (base * 500) / 10_000;

        usdc.mint(borrower, base + lateFee);
        vm.warp(l.dueDate + 5 days); // within 30-day grace
        uint256 balBefore = usdc.balanceOf(borrower);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.makePayment(loanId);
        vm.stopPrank();
        assertEq(balBefore - usdc.balanceOf(borrower), base + lateFee, "base + 5% late fee charged");
        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Grace), "status = Grace");
    }

    function test_Payment_PastGrace_Reverts() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        uint256 due = vault.getLoan(loanId).dueDate;
        usdc.mint(borrower, LOAN);
        vm.warp(due + 30 days + 1); // past grace
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(KreditoVault.PaymentOverdue.selector);
        vault.makePayment(loanId);
        vm.stopPrank();
    }

    function test_Payment_OnlyBorrower() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        vm.warp(vault.getLoan(loanId).dueDate);
        vm.prank(keeper);
        vm.expectRevert(KreditoVault.NotBorrower.selector);
        vault.makePayment(loanId);
    }

    // =====================================================================
    // 3. Protocol fee reaches the insurance pool
    // =====================================================================

    function test_ProtocolFee_StreamsToInsurance() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 interest = (l.principal * l.annualRateBps) / (10_000 * 12);
        uint256 fee = (interest * vault.protocolFeeBps()) / 10_000;
        assertGt(fee, 0, "fee positive");

        uint256 insBefore = usdc.balanceOf(address(insurance));
        _payOnTime(borrower, loanId);
        assertEq(usdc.balanceOf(address(insurance)) - insBefore, fee, "protocol fee delivered to insurer");
    }

    function test_ProtocolFee_LateFeeStaysInVaultAsLPYield() public {
        uint256 loanId = _borrow(borrower, LOAN, 12);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 interest = (l.principal * l.annualRateBps) / (10_000 * 12);
        uint256 base = l.principalPerInstallment + interest;
        uint256 lateFee = (base * 500) / 10_000;
        uint256 fee = (interest * vault.protocolFeeBps()) / 10_000;

        uint256 taBefore = vault.totalAssets();
        usdc.mint(borrower, base + lateFee);
        vm.warp(l.dueDate + 5 days);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.makePayment(loanId);
        vm.stopPrank();

        // totalAssets change = +interest (less the fee leaving) + lateFee; principal portion is a wash
        // (idle up, outstanding down). Net to LPs: interest - fee + lateFee.
        uint256 netToLp = interest - fee + lateFee;
        assertEq(vault.totalAssets() - taBefore, netToLp, "late fee + retained interest accrue to LPs");
    }

    // =====================================================================
    // 4. Cover-ratio gate
    // =====================================================================

    function test_CoverRatio_BlocksBorrowWhenTooLow() public {
        // Require an extreme 100% cover ratio: reserves (500k) must be >= outstanding. A 600k loan
        // would push outstanding above reserves, so the gate must block it.
        vault.setRiskParams(0, 10_000, 10_000, 0); // minCover 100%
        uint256 amount = 600_000 * UNIT;
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.CoverRatioTooLow.selector);
        vault.borrow(att, sig, amount, 12);
    }

    function test_CoverRatio_PermitsBorrowWhenSufficient() public {
        vault.setRiskParams(0, 10_000, 2000, 0); // minCover 20%
        // 500k reserves cover up to 2.5M outstanding at 20%; a 100k loan is well within.
        uint256 loanId = _borrow(borrower, 100_000 * UNIT, 12);
        assertEq(vault.getLoan(loanId).principal, 100_000 * UNIT, "loan permitted under cover gate");
    }

    // =====================================================================
    // 5. Per-borrower exposure cap
    // =====================================================================

    function test_ExposureCap_BlocksBorrowerOverCap() public {
        // Cap 5% of totalAssets (1,000,000) = 50,000. A 60,000 loan must revert.
        vault.setRiskParams(0, 500, 0, 0);
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.ExposureCapExceeded.selector);
        vault.borrow(att, sig, 60_000 * UNIT, 12);
    }

    function test_ExposureCap_AllowsMultipleConcurrentLoansUnderCap() public {
        vault.setRiskParams(0, 1000, 0, 0); // cap 10% = 100,000
        uint256 l1 = _borrow(borrower, 40_000 * UNIT, 12);
        uint256 l2 = _borrow(borrower, 40_000 * UNIT, 12);
        assertEq(vault.activePrincipalByBorrower(borrower), 80_000 * UNIT, "two concurrent loans summed");
        assertTrue(l1 != l2, "distinct loan ids");

        // A third loan that would breach the cap reverts.
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.ExposureCapExceeded.selector);
        vault.borrow(att, sig, 30_000 * UNIT, 12);
    }

    // =====================================================================
    // 6. Liquidity buffer respected
    // =====================================================================

    function test_LiquidityBuffer_BlocksBorrowIntoBuffer() public {
        // Buffer 10% of 1,000,000 = 100,000 idle must remain. Borrowing 950,000 (idle-100k=900k max)
        // must revert.
        vault.setRiskParams(1000, 10_000, 0, 0);
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        vm.prank(borrower);
        vm.expectRevert(KreditoVault.InsufficientLiquidity.selector);
        vault.borrow(att, sig, 950_000 * UNIT, 12);

        // Borrowing exactly up to the buffer edge works.
        uint256 maxBorrow = vault.idleLiquidity() - (vault.totalAssets() * 1000) / 10_000;
        uint256 loanId = _borrow(borrower, maxBorrow, 12);
        assertEq(vault.getLoan(loanId).principal, maxBorrow, "borrow up to buffer edge permitted");
    }

    // =====================================================================
    // 7. Defaults — the three insurance scenarios
    // =====================================================================

    function _defaultableLoan(uint256 amount) internal returns (uint256 loanId) {
        loanId = _borrow(borrower, amount, 12);
        // Warp past dueDate + grace without any payment.
        vm.warp(vault.getLoan(loanId).dueDate + 30 days + 1);
    }

    function test_Default_FullInsurance_LPsMadeWhole() public {
        uint256 amount = 100_000 * UNIT;
        uint256 loanId = _defaultableLoan(amount);

        uint256 taBefore = vault.totalAssets(); // == SEED
        // Insurer fully funded (500k reserves >> 100k claim) -> recovered == claim, LPs whole.
        vm.prank(keeper);
        vault.processDefault(loanId);

        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Defaulted), "defaulted");
        // totalAssets drops by principal then rises by recovered (>= principal). With full cover, net >= 0.
        assertGe(vault.totalAssets(), taBefore, "LPs made whole (recovered covers principal + interest)");
    }

    function test_Default_PartialInsurance_LPsBearExactBadDebt() public {
        // Drain the insurer to a small reserve so the claim is only partially covered. Warp past the
        // COVER redeem cooldown first (coverLp deposited in setUp).
        vm.warp(block.timestamp + insurance.redeemCooldown());
        vm.prank(coverLp);
        insurance.withdraw(COVER_SEED - 30_000 * UNIT, coverLp, coverLp); // leave 30,000 reserves

        uint256 amount = 100_000 * UNIT;
        uint256 loanId = _defaultableLoan(amount);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 elapsed = block.timestamp - l.lastPaymentDate;
        uint256 accrued = (l.principal * l.annualRateBps * elapsed) / (365 days * 10_000);
        uint256 claim = l.principal + accrued;
        uint256 reserves = insurance.totalAssets();
        assertLt(reserves, claim, "insurer underfunded for this claim");

        uint256 taBefore = vault.totalAssets();
        uint256 recovered = reserves; // pays min(claim, totalAssets) = reserves
        uint256 badDebt = l.principal + accrued - recovered; // vs claim

        vm.prank(keeper);
        vault.processDefault(loanId);

        // totalAssets = -principal + recovered. The drop equals principal - recovered == LP bad debt.
        uint256 expectedTa = taBefore - l.principal + recovered;
        assertEq(vault.totalAssets(), expectedTa, "totalAssets = before - principal + recovered");
        // The LP loss equals (principal - recovered); note the LPs never expected the accrued interest,
        // so their realized loss is bounded by principal. badDebt (vs full claim) >= LP principal loss.
        assertEq(taBefore - vault.totalAssets(), l.principal - recovered, "LPs bear exactly principal bad debt");
        assertGt(badDebt, 0, "there is bad debt vs the full claim");
        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Defaulted), "still finalized");
    }

    function test_Default_PausedInsurer_StillFinalizes() public {
        uint256 amount = 100_000 * UNIT;
        uint256 loanId = _defaultableLoan(amount);

        // Pause the insurer. processClaim is NOT whenNotPaused, so it would actually still pay; to prove
        // the try/catch tolerance we ALSO point the vault at a reverting insurer below. Here we confirm
        // a paused insurer (deposits halted) does not block the default.
        insurance.pause();
        uint256 taBefore = vault.totalAssets();
        vm.prank(keeper);
        vault.processDefault(loanId); // must not revert
        assertEq(
            uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Defaulted), "finalized while paused"
        );
        // Paused insurer still paid (claims are intentionally payable while paused), so LPs whole.
        assertGe(vault.totalAssets(), taBefore, "claims payable even while insurer paused");
    }

    function test_Default_RevertingInsurer_StillFinalizesViaTryCatch() public {
        // Swap in an insurer that ALWAYS reverts in processClaim. The vault's try/catch must absorb it
        // and finalize the default with recovered == 0 (full bad debt to LPs).
        RevertingInsurer bad = new RevertingInsurer();
        vault.setInsurancePool(address(bad));

        uint256 amount = 100_000 * UNIT;
        uint256 loanId = _defaultableLoan(amount);
        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 taBefore = vault.totalAssets();

        vm.prank(keeper);
        vault.processDefault(loanId); // must NOT revert despite the insurer reverting

        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Defaulted), "finalized");
        // recovered == 0 -> totalAssets drops by the full principal (LPs bear all of it).
        assertEq(taBefore - vault.totalAssets(), l.principal, "full principal bad debt, default still finalized");
    }

    function test_Default_NotYetDefaultable_Reverts() public {
        uint256 loanId = _borrow(borrower, 100_000 * UNIT, 12);
        // Before grace ends, processDefault reverts.
        vm.warp(vault.getLoan(loanId).dueDate + 30 days); // exactly at edge, not past
        vm.prank(keeper);
        vm.expectRevert(KreditoVault.NotDefaultable.selector);
        vault.processDefault(loanId);
    }

    /// @dev Regression: the final installment must clear the debt and reach Repaid (no NFT side-effect
    ///      gates the close path; loans are tracked purely by the vault's own loan mapping).
    function test_MakePayment_FinalInstallmentClosesLoan() public {
        uint256 loanId = _borrow(borrower, LOAN, 6);
        usdc.mint(borrower, LOAN * 2);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        // Pay every installment but the last.
        for (uint256 i; i < 5; i++) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vm.prank(borrower);
            vault.makePayment(loanId);
        }
        assertGt(vault.getLoan(loanId).principal, 0, "still outstanding before final payment");

        // The final payment closes the loan.
        vm.warp(vault.getLoan(loanId).dueDate);
        vm.prank(borrower);
        vault.makePayment(loanId);

        assertEq(vault.getLoan(loanId).principal, 0, "principal cleared on final payment");
        assertEq(
            uint8(vault.getLoan(loanId).status),
            uint8(KreditoVault.LoanStatus.Repaid),
            "loan reaches Repaid on final installment"
        );
    }

    // =====================================================================
    // 9. ERC-7540 async redeem still works after loans + repays
    // =====================================================================

    function test_ERC7540_RedeemWorksAfterLoanCycle() public {
        // Borrow, fully repay, then run a full async redeem of the LP's shares.
        uint256 loanId = _borrow(borrower, 100_000 * UNIT, 12);
        usdc.mint(borrower, 200_000 * UNIT);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        while (vault.getLoan(loanId).status != KreditoVault.LoanStatus.Repaid) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vault.makePayment(loanId);
        }
        vm.stopPrank();

        uint256 shares = vault.balanceOf(address(this));
        vault.requestRedeem(shares, address(this), address(this));
        uint256 owed = vault.convertToAssets(shares);
        vault.fulfillRedeem(address(this), shares);
        uint256 balBefore = usdc.balanceOf(address(this));
        vault.redeem(shares, address(this), address(this));
        assertEq(usdc.balanceOf(address(this)) - balBefore, owed, "LP claimed locked-rate assets post-loan-cycle");
        assertEq(vault.totalClaimableAssets(), 0, "reserve cleared");
    }

    // =====================================================================
    // 10. Regression: share price not inflated by loans (totalOutstanding counted)
    // =====================================================================

    function test_Regression_SharePriceTracksOutstanding() public {
        uint256 priceBefore = vault.convertToAssets(1e12); // assets per 1e12 shares
        _borrow(borrower, 200_000 * UNIT, 12);
        uint256 priceAfter = vault.convertToAssets(1e12);
        // Lending out principal must NOT change the share price: totalAssets = idle + outstanding.
        assertEq(priceAfter, priceBefore, "share price unchanged by lending (outstanding counted)");
        assertEq(vault.totalAssets(), SEED, "totalAssets invariant across a borrow");
    }

    // =====================================================================
    // 11. Insurance pool unit behavior
    // =====================================================================

    function test_Insurance_CoverRatioMath() public view {
        // 500k reserves, 0 outstanding -> max.
        assertEq(insurance.coverRatio(0), type(uint256).max, "infinite cover when nothing outstanding");
        // 500k / 1,000,000 outstanding = 5000 bps (50%).
        assertEq(insurance.coverRatio(1_000_000 * UNIT), 5000, "50% cover ratio in bps");
    }

    function test_Insurance_ProcessClaim_OnlyVault() public {
        vm.prank(keeper);
        vm.expectRevert(KreditoInsurancePool.OnlyVault.selector);
        insurance.processClaim(1, 1, 1, 1);
    }

    function test_Insurance_ProcessClaim_PartialPayoutNeverReverts() public {
        // Drain insurer to 1,000 reserves, then claim 100,000: pays 1,000, badDebt 99,000, no revert.
        // The coverLp deposited in setUp; the default 1h cooldown has not elapsed relative to that
        // deposit, so warp past it before withdrawing.
        vm.warp(block.timestamp + insurance.redeemCooldown());
        vm.prank(coverLp);
        insurance.withdraw(COVER_SEED - 1_000 * UNIT, coverLp, coverLp);

        // Call as the vault directly (impersonate) to assert the partial-pay invariant in isolation.
        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        vm.prank(address(vault));
        uint256 paid = insurance.processClaim(1, 100_000 * UNIT, 0, 1);
        assertEq(paid, 1_000 * UNIT, "paid min(owed, reserves)");
        assertEq(usdc.balanceOf(address(vault)) - vaultBalBefore, 1_000 * UNIT, "vault received the partial");
    }

    // =====================================================================
    // 11b. M-1 — redeem cooldown defends the cover-ratio borrow gate
    // =====================================================================

    /// @dev A fresh COVER deposit cannot be redeemed in the same block: the cooldown gate reverts.
    function test_Insurance_Cooldown_SameBlockRedeemReverts() public {
        address lp = address(0xDEAD11);
        usdc.mint(lp, 50_000 * UNIT);
        vm.startPrank(lp);
        usdc.approve(address(insurance), type(uint256).max);
        uint256 shares = insurance.deposit(50_000 * UNIT, lp);
        // Same block, no warp -> cooldown is active.
        vm.expectRevert(KreditoInsurancePool.CooldownActive.selector);
        insurance.redeem(shares, lp, lp);
        // withdraw is gated identically.
        vm.expectRevert(KreditoInsurancePool.CooldownActive.selector);
        insurance.withdraw(1 * UNIT, lp, lp);
        vm.stopPrank();
    }

    /// @dev After the cooldown elapses, a normal COVER LP can redeem/withdraw as usual.
    function test_Insurance_Cooldown_RedeemSucceedsAfterCooldown() public {
        address lp = address(0xDEAD12);
        usdc.mint(lp, 50_000 * UNIT);
        vm.startPrank(lp);
        usdc.approve(address(insurance), type(uint256).max);
        uint256 shares = insurance.deposit(50_000 * UNIT, lp);
        vm.warp(block.timestamp + insurance.redeemCooldown());
        uint256 balBefore = usdc.balanceOf(lp);
        uint256 assets = insurance.redeem(shares, lp, lp);
        vm.stopPrank();
        assertEq(usdc.balanceOf(lp) - balBefore, assets, "LP redeemed reserves after cooldown");
        assertEq(insurance.balanceOf(lp), 0, "all COVER shares burned");
    }

    /// @dev The review's bypass: deposit cover -> let a borrow pass the cover gate -> redeem 100% back
    ///      in the SAME tx, originating against effectively-zero committed reserves. With the cooldown
    ///      the redeem step now reverts, so the atomic round-trip is blocked.
    function test_Insurance_Cooldown_AtomicDepositBorrowRedeemBypassReverts() public {
        // Fresh stack with an EMPTY insurer so the only cover backing a borrow is the attacker's
        // about-to-be-yanked deposit. Require a 100% cover ratio to make the gate bite.
        KreditoVault v = new KreditoVault(IERC20(address(usdc)), issuer);
        KreditoInsurancePool ins = new KreditoInsurancePool(IERC20(address(usdc)));
        v.setInsurancePool(address(ins));
        ins.setVault(address(v));
        v.setRiskParams(0, 10_000, 10_000, 0); // minCover 100%, no buffer, no exposure cap

        // Seed the lending vault so it has liquidity to lend.
        usdc.mint(address(this), SEED);
        usdc.approve(address(v), type(uint256).max);
        v.deposit(SEED, address(this));

        // The attacker is the cover depositor AND the borrower.
        uint256 borrowAmount = 100_000 * UNIT;
        usdc.mint(borrower, borrowAmount); // exactly enough cover to pass 100% on this loan
        vm.startPrank(borrower);
        usdc.approve(address(ins), type(uint256).max);
        uint256 coverShares = ins.deposit(borrowAmount, borrower);

        // Borrow passes the cover gate against the just-deposited reserves.
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        v.borrow(att, sig, borrowAmount, 12);

        // The bypass step: yank the cover back in the same block. Cooldown blocks it.
        vm.expectRevert(KreditoInsurancePool.CooldownActive.selector);
        ins.redeem(coverShares, borrower, borrower);
        vm.stopPrank();

        // Cover remains genuinely committed: the insurer still holds the reserves.
        assertEq(ins.totalAssets(), borrowAmount, "cover not yanked - reserves stay committed");
    }

    /// @dev `processClaim` (vault-only default payout) must NOT be affected by the cooldown — defaults
    ///      pay out instantly even on a brand-new, never-aged reserve.
    function test_Insurance_Cooldown_ProcessClaimUnaffected() public {
        // Fresh insurer wired to a fresh vault; deposit cover and IMMEDIATELY drive a claim in the
        // same block. The cooldown gates LP exits, never the vault's payout.
        KreditoInsurancePool ins = new KreditoInsurancePool(IERC20(address(usdc)));
        ins.setVault(address(this)); // impersonate the vault so we can call processClaim directly

        address lp = address(0xC0FFEE);
        usdc.mint(lp, 100_000 * UNIT);
        vm.startPrank(lp);
        usdc.approve(address(ins), type(uint256).max);
        ins.deposit(100_000 * UNIT, lp);
        vm.stopPrank();

        // Same block as the deposit — no warp. processClaim still pays.
        uint256 balBefore = usdc.balanceOf(address(this));
        uint256 paid = ins.processClaim(1, 40_000 * UNIT, 0, 1);
        assertEq(paid, 40_000 * UNIT, "claim paid instantly despite active deposit cooldown");
        assertEq(usdc.balanceOf(address(this)) - balBefore, 40_000 * UNIT, "vault received the payout");
    }

    /// @dev The cooldown setter is owner-only and bounded by MAX_REDEEM_COOLDOWN (7 days).
    function test_Insurance_Cooldown_SetterBounded() public {
        insurance.setRedeemCooldown(2 days);
        assertEq(insurance.redeemCooldown(), 2 days, "cooldown updated");

        vm.expectRevert(KreditoInsurancePool.CooldownTooLong.selector);
        insurance.setRedeemCooldown(7 days + 1);

        vm.prank(keeper);
        vm.expectRevert();
        insurance.setRedeemCooldown(1 days);
    }

    // =====================================================================
    // 12. Admin / config bounds
    // =====================================================================

    function test_Admin_SetRiskParamsBounds() public {
        vm.expectRevert(KreditoVault.InvalidParam.selector);
        vault.setRiskParams(10_001, 0, 0, 0);
        vm.expectRevert(KreditoVault.InvalidParam.selector);
        vault.setRiskParams(0, 0, 0, 10_001);
    }

    function test_Admin_BorrowTermBounds() public {
        KreditoVault.CreditAttestation memory att = _att(borrower, 800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(att);
        vm.startPrank(borrower);
        vm.expectRevert(KreditoVault.InvalidTerm.selector);
        vault.borrow(att, sig, LOAN, 5); // below MIN
        vm.expectRevert(KreditoVault.InvalidTerm.selector);
        vault.borrow(att, sig, LOAN, 37); // above MAX
        vm.stopPrank();
    }

    function test_Admin_RateFromTier_BorrowerCannotPickCheaper() public {
        // tier1 (low, via riskTier 2) = 10%, tier2 (medium, via riskTier 1) = 14%.
        uint256 lowRiskLoan = _borrow(borrower, 50_000 * UNIT, 12, 2);
        assertEq(vault.getLoan(lowRiskLoan).annualRateBps, 1000, "low risk -> tier1 rate 10%");
        uint256 medRiskLoan = _borrow(borrower2, 50_000 * UNIT, 12, 1);
        assertEq(vault.getLoan(medRiskLoan).annualRateBps, 1400, "medium risk -> tier2 rate 14%");
    }

    // =====================================================================
    // Fuzz
    // =====================================================================

    /// @dev For any valid principal/term, the loan amortizes to exactly 0 in exactly `termMonths`
    ///      on-time payments — proving no soft-lock and exact principal conservation across the fuzz space.
    function testFuzz_AmortizationAlwaysClearsInTermMonths(uint256 amount, uint256 termMonths) public {
        amount = bound(amount, 6 * UNIT, 400_000 * UNIT); // within exposure cap (50% of 1M)
        termMonths = bound(termMonths, 6, 36);

        uint256 loanId = _borrow(borrower, amount, termMonths);
        usdc.mint(borrower, amount * 3);
        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        uint256 payments;
        while (vault.getLoan(loanId).status != KreditoVault.LoanStatus.Repaid) {
            vm.warp(vault.getLoan(loanId).dueDate);
            vault.makePayment(loanId);
            payments++;
            require(payments <= termMonths, "soft-lock: exceeded termMonths");
        }
        vm.stopPrank();
        assertEq(payments, termMonths, "cleared in exactly termMonths");
        assertEq(vault.getLoan(loanId).principal, 0, "principal fully repaid");
        assertEq(vault.totalOutstanding(), 0, "outstanding cleared");
    }

    /// @dev For any underfunded insurer reserve, a default still finalizes and LPs' totalAssets drops
    ///      by exactly (principal - recovered) — recovered being min(claim, reserves).
    function testFuzz_DefaultBadDebtIsExact(uint256 reserve, uint256 amount) public {
        amount = bound(amount, 1_000 * UNIT, 400_000 * UNIT);
        reserve = bound(reserve, 0, amount); // underfunded relative to principal

        // Set insurer reserves to exactly `reserve`. Warp past the COVER redeem cooldown first
        // (coverLp deposited in setUp).
        vm.warp(block.timestamp + insurance.redeemCooldown());
        uint256 current = insurance.totalAssets();
        vm.prank(coverLp);
        insurance.withdraw(current - reserve, coverLp, coverLp);
        // minCover 0 so the borrow is not gated by the (now small) reserves.
        vault.setRiskParams(0, 10_000, 0, 0);

        uint256 loanId = _borrow(borrower, amount, 12);
        vm.warp(vault.getLoan(loanId).dueDate + 30 days + 1);

        KreditoVault.Loan memory l = vault.getLoan(loanId);
        uint256 elapsed = block.timestamp - l.lastPaymentDate;
        uint256 accrued = (l.principal * l.annualRateBps * elapsed) / (365 days * 10_000);
        uint256 claim = l.principal + accrued;
        uint256 recovered = claim <= reserve ? claim : reserve;

        uint256 taBefore = vault.totalAssets();
        vm.prank(keeper);
        vault.processDefault(loanId);

        assertEq(uint8(vault.getLoan(loanId).status), uint8(KreditoVault.LoanStatus.Defaulted), "finalized");
        assertEq(
            vault.totalAssets(), taBefore - l.principal + recovered, "totalAssets = before - principal + recovered"
        );
    }
}

/// @dev An insurer whose processClaim always reverts — to prove the vault's try/catch tolerance.
contract RevertingInsurer {
    error Boom();

    function coverRatio(uint256) external pure returns (uint256) {
        return type(uint256).max;
    }

    function processClaim(uint256, uint256, uint256, uint256) external pure returns (uint256) {
        revert Boom();
    }
}
