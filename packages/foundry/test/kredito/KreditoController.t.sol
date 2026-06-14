// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { KreditoController } from "../../contracts/kredito/KreditoController.sol";
import { KreditoResolver } from "../../contracts/kredito/KreditoResolver.sol";
import { IRegistry, IStandardRegistry } from "../../contracts/kredito/interfaces/IEnsV2.sol";

/// @notice Minimal stand-in for kredito.eth's ENSv2 subregistry — records the args `register`
///         was called with so we can assert the controller wires ENSv2 correctly.
contract MockSubRegistry is IStandardRegistry {
    struct Call {
        string label;
        address owner;
        address resolver;
        uint256 roleBitmap;
        uint64 expiry;
    }

    Call public lastCall;
    uint256 public nextTokenId = 1;

    function register(string calldata label, address owner, IRegistry, address resolver, uint256 roleBitmap, uint64 expiry)
        external
        returns (uint256 tokenId)
    {
        lastCall = Call(label, owner, resolver, roleBitmap, expiry);
        tokenId = nextTokenId++;
    }

    function setResolver(uint256, address) external { }
    function setSubregistry(uint256, IRegistry) external { }
    function getExpiry(uint256) external pure returns (uint64) {
        return 0;
    }
    function getSubregistry(string calldata) external view returns (IRegistry) {
        return IRegistry(address(this));
    }
    function getResolver(string calldata) external pure returns (address) {
        return address(0);
    }
    function getParent() external pure returns (IRegistry, string memory) {
        return (IRegistry(address(0)), "");
    }
}

contract KreditoControllerTest is Test {
    KreditoController controller;
    KreditoResolver resolver;
    MockSubRegistry subRegistry;

    address admin = address(0xA11CE);
    address issuer = address(0x155E5); // backend hot key
    address business = address(0xB12);
    address attacker = address(0xBAD);

    bytes32 constant PARENT_NODE = 0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580; // kredito.eth
    uint64 constant FAR_EXPIRY = type(uint64).max;
    string constant ATTESTATION = "0xattestationhash";

    function setUp() public {
        subRegistry = new MockSubRegistry();
        // controller first (resolver needs the controller as its issuer)
        controller = new KreditoController(admin, issuer, PARENT_NODE, FAR_EXPIRY);
        resolver = new KreditoResolver(admin, address(controller));
        vm.startPrank(admin);
        controller.setResolver(resolver);
        controller.setSubRegistry(subRegistry);
        vm.stopPrank();
    }

    function _node(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(PARENT_NODE, keccak256(bytes(label))));
    }

    function test_MintRegistersAndStampsRecords() public {
        vm.prank(issuer);
        (uint256 tokenId, bytes32 node) = controller.mint("acme", business, ATTESTATION);

        assertEq(node, _node("acme"));
        assertEq(tokenId, 1);

        // subregistry got the right register() args
        (string memory label, address owner, address res, uint256 roleBitmap, uint64 expiry) = subRegistry.lastCall();
        assertEq(label, "acme");
        assertEq(owner, business);
        assertEq(res, address(resolver));
        assertEq(expiry, FAR_EXPIRY);
        // owner role bitmap must NOT contain ROLE_SET_RESOLVER (1<<24) — resolution stays pinned
        assertEq(roleBitmap & (1 << 24), 0);

        // resolver records stamped
        assertEq(resolver.nameOwner(node), business);
        assertEq(resolver.addr(node), business);
        assertEq(resolver.text(node, "kredito.status"), "approved");
        assertEq(resolver.text(node, "lendsignal.attestation"), ATTESTATION);
    }

    function test_OnlyIssuerCanMint() public {
        vm.prank(attacker);
        vm.expectRevert();
        controller.mint("acme", attacker, ATTESTATION);
    }

    function test_MintIsIdempotent() public {
        vm.prank(issuer);
        controller.mint("acme", business, ATTESTATION);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(KreditoController.AlreadyIssued.selector, _node("acme")));
        controller.mint("acme", business, ATTESTATION);
    }

    function test_BusinessEditsProfileAfterMint() public {
        vm.prank(issuer);
        controller.mint("acme", business, ATTESTATION);

        vm.prank(business);
        resolver.setText(_node("acme"), "url", "https://acme.example");
        assertEq(resolver.text(_node("acme"), "url"), "https://acme.example");

        // but cannot touch the locked status
        vm.prank(business);
        vm.expectRevert(KreditoResolver.NotIssuer.selector);
        resolver.setText(_node("acme"), "kredito.status", "approved");
    }

    function test_RevokeFlipsStatus() public {
        vm.prank(issuer);
        controller.mint("acme", business, ATTESTATION);
        vm.prank(issuer);
        controller.revoke("acme");
        assertEq(resolver.text(_node("acme"), "kredito.status"), "denied");
    }

    function test_IssuerRoleRotation() public {
        address newIssuer = address(0x15);
        vm.startPrank(admin);
        controller.grantRole(controller.ISSUER_ROLE(), newIssuer);
        controller.revokeRole(controller.ISSUER_ROLE(), issuer);
        vm.stopPrank();

        vm.prank(issuer);
        vm.expectRevert();
        controller.mint("acme", business, ATTESTATION);

        vm.prank(newIssuer);
        controller.mint("acme", business, ATTESTATION);
        assertEq(resolver.nameOwner(_node("acme")), business);
    }
}
