// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { KreditoResolver } from "../../contracts/kredito/KreditoResolver.sol";

contract KreditoResolverTest is Test {
    KreditoResolver resolver;

    address admin = address(0xA11CE);
    address issuer = address(0x155E5); // stand-in for KreditoController
    address business = address(0xB12);
    address attacker = address(0xBAD);

    // node = namehash("acme.kredito.eth") = keccak256(namehash("kredito.eth"), keccak256("acme"))
    bytes32 constant KREDITO_NODE = 0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580;
    bytes32 node = keccak256(abi.encodePacked(KREDITO_NODE, keccak256(bytes("acme"))));

    string constant ATTESTATION = "0xattestationhash";

    function setUp() public {
        resolver = new KreditoResolver(admin, issuer);
        vm.prank(issuer);
        resolver.initIdentity(node, business, "approved", ATTESTATION);
    }

    function test_InitSetsOwnerAddrAndLockedRecords() public view {
        assertEq(resolver.nameOwner(node), business);
        assertEq(resolver.addr(node), business);
        assertEq(resolver.text(node, "kredito.status"), "approved");
        assertEq(resolver.text(node, "lendsignal.attestation"), ATTESTATION);
    }

    function test_InitIsIssuerOnlyAndOnce() public {
        vm.prank(attacker);
        vm.expectRevert(KreditoResolver.NotIssuer.selector);
        resolver.initIdentity(node, attacker, "approved", ATTESTATION);

        vm.prank(issuer);
        vm.expectRevert(KreditoResolver.AlreadyInitialized.selector);
        resolver.initIdentity(node, business, "approved", ATTESTATION);
    }

    // --- the make-or-break: resolve() must return exactly what viem/UniversalResolver decodes ---

    function test_Resolve_Addr() public view {
        bytes memory data = abi.encodeWithSelector(0x3b3b57de, node); // addr(bytes32)
        bytes memory ret = resolver.resolve("", data);
        assertEq(abi.decode(ret, (address)), business);
    }

    function test_Resolve_Text() public view {
        bytes memory data = abi.encodeWithSelector(0x59d1d43c, node, "kredito.status"); // text(bytes32,string)
        bytes memory ret = resolver.resolve("", data);
        assertEq(abi.decode(ret, (string)), "approved");
    }

    function test_Resolve_AddrCoinEth() public view {
        bytes memory data = abi.encodeWithSelector(0xf1cb7e06, node, uint256(60)); // addr(bytes32,uint256)
        bytes memory ret = resolver.resolve("", data);
        bytes memory raw = abi.decode(ret, (bytes));
        assertEq(raw.length, 20);
        assertEq(address(uint160(bytes20(raw))), business);
    }

    function test_Resolve_RevertsOnUnknownProfile() public {
        bytes memory data = abi.encodeWithSelector(0xdeadbeef, node);
        vm.expectRevert(abi.encodeWithSelector(KreditoResolver.UnsupportedResolverProfile.selector, bytes4(0xdeadbeef)));
        resolver.resolve("", data);
    }

    // --- split ACL ---

    function test_OwnerCanEditProfile() public {
        vm.prank(business);
        resolver.setText(node, "url", "https://acme.example");
        assertEq(resolver.text(node, "url"), "https://acme.example");

        vm.prank(business);
        resolver.setText(node, "com.twitter", "acme");
        assertEq(resolver.text(node, "com.twitter"), "acme");
    }

    function test_NonOwnerCannotEditProfile() public {
        vm.prank(attacker);
        vm.expectRevert(KreditoResolver.NotOwner.selector);
        resolver.setText(node, "url", "https://evil.example");
    }

    function test_OwnerCannotWriteLockedStatus() public {
        vm.prank(business);
        vm.expectRevert(KreditoResolver.NotIssuer.selector);
        resolver.setText(node, "kredito.status", "approved");
    }

    function test_OwnerCannotWriteLockedAttestation() public {
        vm.prank(business);
        vm.expectRevert(KreditoResolver.NotIssuer.selector);
        resolver.setText(node, "lendsignal.attestation", "0xforged");
    }

    function test_IssuerCanRevokeStatus() public {
        vm.prank(issuer);
        resolver.setStatus(node, "denied");
        assertEq(resolver.text(node, "kredito.status"), "denied");
    }

    function test_SupportsExtendedResolverInterface() public view {
        assertTrue(resolver.supportsInterface(0x9061b923)); // IExtendedResolver (ENSIP-10) — load-bearing
        assertTrue(resolver.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(resolver.supportsInterface(0x59d1d43c)); // text
        assertTrue(resolver.supportsInterface(0x3b3b57de)); // addr
        assertFalse(resolver.supportsInterface(0xffffffff));
    }

    function test_IssuerRotation() public {
        address newIssuer = address(0x15);
        vm.prank(admin);
        resolver.setIssuer(newIssuer);
        assertEq(resolver.issuer(), newIssuer);

        vm.prank(newIssuer);
        resolver.setStatus(node, "review");
        assertEq(resolver.text(node, "kredito.status"), "review");
    }

    function test_OwnerCanBatchEditProfile() public {
        string[] memory keys = new string[](3);
        string[] memory vals = new string[](3);
        keys[0] = "url";
        vals[0] = "https://acme.example";
        keys[1] = "com.twitter";
        vals[1] = "acme";
        keys[2] = "description";
        vals[2] = "B2B supplier";
        vm.prank(business);
        resolver.setTexts(node, keys, vals);
        assertEq(resolver.text(node, "url"), "https://acme.example");
        assertEq(resolver.text(node, "com.twitter"), "acme");
        assertEq(resolver.text(node, "description"), "B2B supplier");
    }

    function test_BatchRejectsLockedKeyFromOwner() public {
        string[] memory keys = new string[](2);
        string[] memory vals = new string[](2);
        keys[0] = "url";
        vals[0] = "https://acme.example";
        keys[1] = "kredito.status";
        vals[1] = "approved";
        vm.prank(business);
        vm.expectRevert(KreditoResolver.NotIssuer.selector);
        resolver.setTexts(node, keys, vals);
    }

    function test_BatchLengthMismatchReverts() public {
        string[] memory keys = new string[](2);
        string[] memory vals = new string[](1);
        keys[0] = "url";
        keys[1] = "name";
        vals[0] = "x";
        vm.prank(business);
        vm.expectRevert(KreditoResolver.LengthMismatch.selector);
        resolver.setTexts(node, keys, vals);
    }
}
