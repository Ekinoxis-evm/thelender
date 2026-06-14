// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { KreditoCreditVault } from "../../contracts/lendsignal/KreditoCreditVault.sol";
import { MockERC20 } from "../../contracts/lendsignal/mocks/MockERC20.sol";

contract KreditoCreditVaultTest is Test {
    MockERC20 internal usdc;
    KreditoCreditVault internal vault;

    // Known issuer key — its address is set as the vault issuer.
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant ROGUE_PK = 0xBEEF;
    address internal issuer;
    address internal rogue;

    address internal borrower = address(0xB0B);

    uint256 internal constant UNIT = 1e6; // 6-decimal asset
    uint256 internal constant DEPOSIT = 1_000_000 * UNIT;
    uint256 internal constant LOAN = 10_000 * UNIT;

    // Locally recomputed EIP-712 constants — MUST match the contract & the viem signer.
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 internal constant CREDIT_ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)"
    );
    bytes32 internal localDomainSeparator;

    function setUp() public {
        vm.warp(1_000_000);
        issuer = vm.addr(ISSUER_PK);
        rogue = vm.addr(ROGUE_PK);

        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        vault = new KreditoCreditVault(IERC20(address(usdc)), issuer);

        // Recompute the domain separator the same way the contract does (no verifyingContract).
        localDomainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256(bytes("Kredito")), keccak256(bytes("1")), block.chainid)
        );

        // Seed liquidity.
        usdc.mint(address(this), DEPOSIT);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(DEPOSIT);
    }

    // ---------------------------------------------------------------------
    // EIP-712 helpers (mirror the contract / viem signer byte-for-byte)
    // ---------------------------------------------------------------------

    function _att(uint256 score, uint8 riskTier, uint256 expiresAt)
        internal
        view
        returns (KreditoCreditVault.CreditAttestation memory)
    {
        return KreditoCreditVault.CreditAttestation({
            borrower: borrower,
            score: score,
            riskTier: riskTier,
            evidenceDigest: keccak256("evidence"),
            issuedAt: block.timestamp,
            expiresAt: expiresAt
        });
    }

    function _digest(KreditoCreditVault.CreditAttestation memory att) internal view returns (bytes32) {
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

    function _sign(uint256 pk, KreditoCreditVault.CreditAttestation memory att) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(att));
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // EIP-712 parity & sanity
    // ---------------------------------------------------------------------

    function test_DomainSeparatorMatchesLocalRecompute() public view {
        assertEq(vault.domainSeparator(), localDomainSeparator, "domain separator mismatch");
        assertEq(vault.EIP712_DOMAIN_TYPEHASH(), EIP712_DOMAIN_TYPEHASH, "domain typehash mismatch");
        assertEq(vault.CREDIT_ATTESTATION_TYPEHASH(), CREDIT_ATTESTATION_TYPEHASH, "att typehash mismatch");
    }

    function test_HashAttestationMatchesLocalDigest() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        assertEq(vault.hashAttestation(att), _digest(att), "digest mismatch");
    }

    function test_RecoverIssuerMatchesConfiguredIssuer() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        assertEq(vault.recoverIssuer(att, sig), issuer, "recovered signer != issuer");
        assertEq(vault.issuer(), issuer, "issuer not configured");
    }

    // ---------------------------------------------------------------------
    // isEligible
    // ---------------------------------------------------------------------

    function test_IsEligible_TrueForValidInRangeUnexpired() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        assertTrue(vault.isEligible(att, sig), "should be eligible");
    }

    function test_IsEligible_FalseWhenScoreTampered() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        att.score = 999; // tamper AFTER signing -> recovered signer changes
        assertFalse(vault.isEligible(att, sig), "tampered score must fail");
    }

    function test_IsEligible_FalseWhenBorrowerTampered() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        att.borrower = address(0xDEAD);
        assertFalse(vault.isEligible(att, sig), "tampered borrower must fail");
    }

    function test_IsEligible_FalseWhenExpiresAtTampered() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        att.expiresAt = block.timestamp + 999 days;
        assertFalse(vault.isEligible(att, sig), "tampered expiresAt must fail");
    }

    function test_IsEligible_FalseWhenExpired() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        vm.warp(att.expiresAt + 1);
        assertFalse(vault.isEligible(att, sig), "expired must fail");
    }

    function test_IsEligible_FalseWhenScoreBelowMin() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(749, 2, block.timestamp + 1 days); // min is 750
        bytes memory sig = _sign(ISSUER_PK, att);
        assertFalse(vault.isEligible(att, sig), "below minScore must fail");
    }

    function test_IsEligible_FalseWhenRiskTierHigh() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 0, block.timestamp + 1 days); // 0 = high
        bytes memory sig = _sign(ISSUER_PK, att);
        assertFalse(vault.isEligible(att, sig), "high risk tier must fail");
    }

    function test_IsEligible_FalseWhenSignedByNonIssuer() public view {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ROGUE_PK, att); // not the issuer
        assertFalse(vault.isEligible(att, sig), "non-issuer signature must fail");
    }

    // ---------------------------------------------------------------------
    // borrow
    // ---------------------------------------------------------------------

    function test_Borrow_HappyPath_TransfersAndDecrementsLiquidity() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.prank(borrower);
        uint256 loanId = vault.borrow(att, sig, LOAN);

        assertEq(usdc.balanceOf(borrower), LOAN, "borrower funded");
        assertEq(vault.liquidity(), DEPOSIT - LOAN, "liquidity decremented");
        assertEq(vault.totalOutstanding(), LOAN, "outstanding tracked");
        assertEq(vault.openLoanOf(borrower), loanId, "open loan set");

        KreditoCreditVault.Loan memory loan = vault.getLoan(loanId);
        assertEq(loan.borrower, borrower, "loan borrower");
        assertEq(loan.principal, LOAN, "loan principal");
        assertTrue(vault.attestationUsed(loan.attestationDigest), "attestation burned");
    }

    function test_Borrow_ReplayGuard_SameAttestationReverts() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.startPrank(borrower);
        uint256 loanId = vault.borrow(att, sig, LOAN);
        // borrower received exactly LOAN; repay it to clear the open-loan slot so the second
        // borrow fails on the replay guard rather than HasOpenLoan.
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();

        vm.prank(borrower);
        vm.expectRevert(KreditoCreditVault.AttestationAlreadyUsed.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_ByNonBorrowerReverts() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.prank(address(0xCAFE)); // not att.borrower
        vm.expectRevert(KreditoCreditVault.NotBorrower.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_IneligibleReverts() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ROGUE_PK, att); // bad signer -> ineligible

        vm.prank(borrower);
        vm.expectRevert(KreditoCreditVault.NotEligible.selector);
        vault.borrow(att, sig, LOAN);
    }

    function test_Borrow_ExceedsLiquidityReverts() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.prank(borrower);
        vm.expectRevert(KreditoCreditVault.InsufficientLiquidity.selector);
        vault.borrow(att, sig, DEPOSIT + 1);
    }

    function test_Borrow_HasOpenLoanReverts() public {
        // First, valid borrow with attestation A.
        KreditoCreditVault.CreditAttestation memory attA = _att(800, 2, block.timestamp + 1 days);
        bytes memory sigA = _sign(ISSUER_PK, attA);
        vm.prank(borrower);
        vault.borrow(attA, sigA, LOAN);

        // Distinct attestation B (different evidenceDigest via issuedAt) still blocked by open loan.
        KreditoCreditVault.CreditAttestation memory attB = _att(800, 2, block.timestamp + 2 days);
        bytes memory sigB = _sign(ISSUER_PK, attB);
        vm.prank(borrower);
        vm.expectRevert(KreditoCreditVault.HasOpenLoan.selector);
        vault.borrow(attB, sigB, LOAN);
    }

    // ---------------------------------------------------------------------
    // repay & admin
    // ---------------------------------------------------------------------

    function test_RepayReturnsCapital() public {
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.prank(borrower);
        uint256 loanId = vault.borrow(att, sig, LOAN);

        vm.startPrank(borrower);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(loanId);
        vm.stopPrank();

        assertEq(vault.liquidity(), DEPOSIT, "capital returned");
        assertEq(vault.totalOutstanding(), 0, "nothing outstanding");
        assertEq(vault.openLoanOf(borrower), 0, "open loan cleared");
    }

    function test_SetIssuer_OnlyOwner() public {
        vm.prank(address(0x1234));
        vm.expectRevert();
        vault.setIssuer(rogue);

        vault.setIssuer(rogue); // owner = this
        assertEq(vault.issuer(), rogue, "issuer updated");
    }

    function test_SetMinScore_OnlyOwnerAndNonZero() public {
        vm.prank(address(0x1234));
        vm.expectRevert();
        vault.setMinScore(600);

        vm.expectRevert(KreditoCreditVault.InvalidMinScore.selector);
        vault.setMinScore(0);

        vault.setMinScore(600);
        assertEq(vault.minScore(), 600, "minScore updated");
    }

    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert(KreditoCreditVault.ZeroAddress.selector);
        new KreditoCreditVault(IERC20(address(0)), issuer);

        vm.expectRevert(KreditoCreditVault.ZeroAddress.selector);
        new KreditoCreditVault(IERC20(address(usdc)), address(0));
    }

    // ---------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------

    function testFuzz_IsEligible_ScoreBoundary(uint256 score) public view {
        score = bound(score, 0, 2000);
        KreditoCreditVault.CreditAttestation memory att = _att(score, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);
        bool expected = score >= vault.minScore();
        assertEq(vault.isEligible(att, sig), expected, "score boundary eligibility");
    }

    function testFuzz_Borrow_AmountWithinLiquidity(uint256 amount) public {
        amount = bound(amount, 1, DEPOSIT);
        KreditoCreditVault.CreditAttestation memory att = _att(800, 2, block.timestamp + 1 days);
        bytes memory sig = _sign(ISSUER_PK, att);

        vm.prank(borrower);
        vault.borrow(att, sig, amount);

        assertEq(usdc.balanceOf(borrower), amount, "funded amount");
        assertEq(vault.liquidity(), DEPOSIT - amount, "liquidity decremented by amount");
    }
}
