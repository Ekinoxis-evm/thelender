// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { CreditCertificateRegistry } from "../../contracts/lendsignal/CreditCertificateRegistry.sol";
import { CreditTypes } from "../../contracts/lendsignal/libraries/CreditTypes.sol";

contract CreditCertificateRegistryTest is Test {
    CreditCertificateRegistry internal registry;
    address internal issuer = address(0xA11CE);
    address internal borrower = address(0xB0B);

    function setUp() public {
        vm.warp(1_000_000);
        registry = new CreditCertificateRegistry(issuer);
    }

    function _inputs(uint256 ai, uint256 bureau) internal view returns (CreditTypes.ScoreInputs memory) {
        return CreditTypes.ScoreInputs({
            confidentialAiScore: ai,
            bureauScore: bureau,
            attestationHash: keccak256("att"),
            bureauReportHash: keccak256("rep"),
            evidenceDigest: keccak256("ev"),
            expiresAt: block.timestamp + 30 days
        });
    }

    function test_IssueComputesScoreAndTier() public {
        vm.prank(issuer);
        registry.issueCertificate(borrower, _inputs(840, 782));
        // (840*7000 + 782*3000) / 10000 = 822
        CreditTypes.CreditCertificate memory c = registry.getCertificate(borrower);
        assertEq(c.combinedScore, 822, "combined");
        assertEq(uint256(c.riskTier), uint256(CreditTypes.RiskTier.Low), "tier");
        assertEq(c.version, 1, "version");
        assertTrue(registry.isEligible(borrower), "eligible");
        assertEq(registry.borrowersCount(), 1, "indexed");
    }

    function test_WeakBorrowerIneligible() public {
        vm.prank(issuer);
        registry.issueCertificate(borrower, _inputs(500, 560)); // 518 -> High
        assertEq(registry.combinedScoreOf(borrower), 518);
        assertFalse(registry.isEligible(borrower));
    }

    function test_OnlyIssuerCanIssue() public {
        vm.expectRevert(CreditCertificateRegistry.NotIssuer.selector);
        registry.issueCertificate(borrower, _inputs(840, 782));
    }

    function test_RejectsScoreAboveMax() public {
        vm.prank(issuer);
        vm.expectRevert(CreditCertificateRegistry.InvalidScore.selector);
        registry.issueCertificate(borrower, _inputs(1001, 782));
    }

    function test_RejectsPastExpiry() public {
        CreditTypes.ScoreInputs memory inp = _inputs(840, 782);
        inp.expiresAt = block.timestamp;
        vm.prank(issuer);
        vm.expectRevert(CreditCertificateRegistry.InvalidExpiry.selector);
        registry.issueCertificate(borrower, inp);
    }

    function test_DoubleIssueReverts() public {
        vm.startPrank(issuer);
        registry.issueCertificate(borrower, _inputs(840, 782));
        vm.expectRevert(CreditCertificateRegistry.AlreadyCertified.selector);
        registry.issueCertificate(borrower, _inputs(840, 782));
        vm.stopPrank();
    }

    function test_UpdateBumpsVersionAndRescores() public {
        vm.startPrank(issuer);
        registry.issueCertificate(borrower, _inputs(840, 782));
        registry.updateCertificate(borrower, _inputs(600, 600)); // 600 -> Medium
        vm.stopPrank();
        CreditTypes.CreditCertificate memory c = registry.getCertificate(borrower);
        assertEq(c.combinedScore, 600);
        assertEq(uint256(c.riskTier), uint256(CreditTypes.RiskTier.Medium));
        assertEq(c.version, 2);
    }

    function test_RevokeMakesIneligible() public {
        vm.startPrank(issuer);
        registry.issueCertificate(borrower, _inputs(840, 782));
        registry.revokeCertificate(borrower);
        vm.stopPrank();
        assertFalse(registry.isEligible(borrower));
        assertEq(uint256(registry.statusOf(borrower)), uint256(CreditTypes.Status.Revoked));
    }

    function test_ExpiryMakesIneligible() public {
        vm.prank(issuer);
        registry.issueCertificate(borrower, _inputs(840, 782));
        vm.warp(block.timestamp + 31 days);
        assertFalse(registry.isEligible(borrower));
        assertEq(uint256(registry.statusOf(borrower)), uint256(CreditTypes.Status.Expired));
    }

    function test_WeightsMustSumTo10k() public {
        vm.expectRevert(CreditCertificateRegistry.InvalidWeights.selector);
        registry.setWeights(7000, 2000);
    }

    function test_OnlyOwnerSetsWeights() public {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, borrower));
        registry.setWeights(7000, 3000);
    }
}
