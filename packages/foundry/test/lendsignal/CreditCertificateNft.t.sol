// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { CreditCertificateRegistry } from "../../contracts/lendsignal/CreditCertificateRegistry.sol";
import { CreditTypes } from "../../contracts/lendsignal/libraries/CreditTypes.sol";

contract CreditCertificateNftTest is Test {
    CreditCertificateRegistry internal registry;
    address internal borrower = address(0xB0B);
    address internal other = address(0xCAFE);

    function setUp() public {
        vm.warp(1_000_000);
        registry = new CreditCertificateRegistry(address(this)); // owner & issuer = this
        registry.issueCertificate(
            borrower,
            CreditTypes.ScoreInputs({
                confidentialAiScore: 840,
                bureauScore: 782,
                attestationHash: keccak256("att"),
                bureauReportHash: keccak256("rep"),
                evidenceDigest: keccak256("ev"),
                expiresAt: block.timestamp + 30 days
            })
        );
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory sb = bytes(s);
        bytes memory pb = bytes(prefix);
        if (sb.length < pb.length) return false;
        for (uint256 i = 0; i < pb.length; i++) {
            if (sb[i] != pb[i]) return false;
        }
        return true;
    }

    function test_IssueMintsSoulboundToken() public view {
        uint256 id = registry.tokenIdOf(borrower);
        assertEq(id, 1);
        assertEq(registry.ownerOf(id), borrower);
        assertEq(registry.balanceOf(borrower), 1);
        assertTrue(registry.locked(id));
        assertEq(keccak256(bytes(registry.symbol())), keccak256(bytes("LSCC")));
    }

    function test_TransfersRevert() public {
        uint256 id = registry.tokenIdOf(borrower);
        vm.startPrank(borrower); // the owner; transfers must still be blocked
        vm.expectRevert(CreditCertificateRegistry.Soulbound.selector);
        registry.transferFrom(borrower, other, id);
        vm.expectRevert(CreditCertificateRegistry.Soulbound.selector);
        registry.safeTransferFrom(borrower, other, id);
        vm.expectRevert(CreditCertificateRegistry.Soulbound.selector);
        registry.safeTransferFrom(borrower, other, id, "");
        vm.stopPrank();
    }

    function test_TokenUriIsOnchainJson() public view {
        string memory uri = registry.tokenURI(registry.tokenIdOf(borrower));
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
        assertGt(bytes(uri).length, 200);
    }

    function test_SupportsExpectedInterfaces() public view {
        assertTrue(registry.supportsInterface(0x01ffc9a7)); // ERC165
        assertTrue(registry.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(registry.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(registry.supportsInterface(0xb45a3c0e)); // ERC5192
        assertFalse(registry.supportsInterface(0xffffffff));
    }

    function test_TokenUriRevertsForNonexistent() public {
        vm.expectRevert(); // OZ ERC721NonexistentToken
        registry.tokenURI(999);
    }
}
