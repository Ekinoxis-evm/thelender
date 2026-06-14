// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { CreditCertificateRegistry } from "../../contracts/lendsignal/CreditCertificateRegistry.sol";
import { CreditTypes } from "../../contracts/lendsignal/libraries/CreditTypes.sol";
import { MockENSRegistry } from "../../contracts/lendsignal/mocks/MockENSRegistry.sol";
import { MockPublicResolver } from "../../contracts/lendsignal/mocks/MockPublicResolver.sol";

contract CreditCertificateRegistryEnsTest is Test {
    CreditCertificateRegistry internal registry;
    MockENSRegistry internal ens;
    MockPublicResolver internal resolver;

    address internal borrower = address(0xB0B);
    bytes32 internal node = keccak256(bytes("bob.eth"));
    bytes32 internal constant ATT = keccak256("att");

    function setUp() public {
        vm.warp(1_000_000);
        registry = new CreditCertificateRegistry(address(this)); // owner & issuer = this
        ens = new MockENSRegistry();
        resolver = new MockPublicResolver();
        registry.setEnsRegistry(address(ens));
        registry.setEnsGateEnabled(true);
    }

    function _certify() internal {
        registry.issueCertificate(
            borrower,
            CreditTypes.ScoreInputs({
                confidentialAiScore: 840,
                bureauScore: 782,
                attestationHash: ATT,
                bureauReportHash: keccak256("rep"),
                evidenceDigest: keccak256("ev"),
                expiresAt: block.timestamp + 30 days
            })
        );
    }

    function _wireResolution(address resolvesTo) internal {
        registry.linkEns(borrower, "bob.eth", node);
        ens.setResolver(node, address(resolver));
        resolver.setAddr(node, resolvesTo);
    }

    function test_GateOn_NoEnsLinked_NotEligible() public {
        _certify();
        assertFalse(registry.isEnsVerified(borrower));
        assertFalse(registry.isEligible(borrower));
    }

    function test_GateOn_NoResolver_NotEligible() public {
        _certify();
        registry.linkEns(borrower, "bob.eth", node);
        assertFalse(registry.isEnsVerified(borrower));
        assertFalse(registry.isEligible(borrower));
    }

    function test_GateOn_ResolvesToBorrower_Eligible() public {
        _certify();
        _wireResolution(borrower);
        assertTrue(registry.isEnsVerified(borrower));
        assertTrue(registry.isEligible(borrower));
    }

    function test_GateOn_ResolvesToOther_NotEligible() public {
        _certify();
        _wireResolution(address(0xDEAD));
        assertFalse(registry.isEnsVerified(borrower));
        assertFalse(registry.isEligible(borrower));
    }

    function test_AttestationRecord_RequiredAndMatched() public {
        _certify();
        _wireResolution(borrower);
        registry.setRequireAttestationRecord(true);
        assertFalse(registry.isEnsVerified(borrower)); // record not set yet

        resolver.setText(node, registry.ATTESTATION_KEY(), registry.attestationRecord(ATT));
        assertTrue(registry.isEnsVerified(borrower));
        assertTrue(registry.isEligible(borrower));
    }

    function test_GateDisabled_PassesWithoutEns() public {
        _certify();
        registry.setEnsGateEnabled(false);
        assertTrue(registry.isEligible(borrower));
    }

    function test_LinkEns_RequiresCertificate() public {
        vm.expectRevert(CreditCertificateRegistry.NotCertified.selector);
        registry.linkEns(borrower, "bob.eth", node);
    }

    function test_LinkEns_RejectsZeroNode() public {
        _certify();
        vm.expectRevert(CreditCertificateRegistry.InvalidEnsNode.selector);
        registry.linkEns(borrower, "bob.eth", bytes32(0));
    }

    function test_AttestationRecord_Format() public view {
        bytes memory b = bytes(registry.attestationRecord(ATT));
        assertEq(b.length, 66); // 0x + 64 hex
        assertEq(b[0], bytes1("0"));
        assertEq(b[1], bytes1("x"));
    }
}
