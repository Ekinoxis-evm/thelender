// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ENS interfaces (minimal)
/// @notice The slices of the ENS registry and resolver LendSignal needs to use an ENS name
///         as a real onchain lending gate.
/// @dev Mainnet/Sepolia ENS registry: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e

interface IENSRegistry {
    function resolver(bytes32 node) external view returns (address);
    function owner(bytes32 node) external view returns (address);
}

interface IAddrResolver {
    function addr(bytes32 node) external view returns (address payable);
}

interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}
