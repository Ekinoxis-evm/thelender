// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAddrResolver, ITextResolver } from "../interfaces/IENS.sol";

/// @title MockPublicResolver
/// @notice Demo ENS resolver supporting `addr` and text records.
contract MockPublicResolver is IAddrResolver, ITextResolver {
    mapping(bytes32 => address) internal _addr;
    mapping(bytes32 => mapping(bytes32 => string)) internal _text; // node => keccak(key) => value

    function setAddr(bytes32 node, address value) external {
        _addr[node] = value;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _text[node][keccak256(bytes(key))] = value;
    }

    function addr(bytes32 node) external view override returns (address payable) {
        return payable(_addr[node]);
    }

    function text(bytes32 node, string calldata key) external view override returns (string memory) {
        return _text[node][keccak256(bytes(key))];
    }
}
