// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IENSRegistry } from "../interfaces/IENS.sol";

/// @title MockENSRegistry
/// @notice Demo ENS registry: maps a namehash to its resolver and owner.
contract MockENSRegistry is IENSRegistry {
    mapping(bytes32 => address) public override resolver;
    mapping(bytes32 => address) public override owner;

    function setResolver(bytes32 node, address resolver_) external {
        resolver[node] = resolver_;
    }

    function setOwner(bytes32 node, address owner_) external {
        owner[node] = owner_;
    }
}
