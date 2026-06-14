// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal ENSv2 (Namechain) interfaces used by KreditoOne
/// @notice Only the slices we need to (a) issue subnames of kredito.eth and (b) be resolved by
///         the ENSv2 UniversalResolver. We deliberately do NOT vendor the full pre-audit
///         `ensdomains/namechain` source — these interfaces are verified against the live,
///         Blockscout-verified contracts on Sepolia.
/// @dev Verified Sepolia (chainId 11155111) addresses:
///        .eth PermissionedRegistry : 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67
///        HCA Factory               : 0x358680728dEDb552adaA9f5eb5d4395B291Cf943
///        LabelStore                : 0x23Ea712Da760c4e09fC9be108F1f1DA6d5d6D053
///        UniversalResolver (mainnet): 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe

/// @notice ENSIP-10 extended resolver. The UniversalResolver dispatches resolution here when the
///         resolver advertises interface id `0x9061b923`. `data` is an ABI-encoded inner call
///         (`addr(bytes32)`, `addr(bytes32,uint256)`, or `text(bytes32,string)`); the return value
///         is the ABI-encoded result of that inner call.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// @notice The hierarchy navigation interface every ENSv2 registry exposes.
interface IRegistry {
    function getSubregistry(string calldata label) external view returns (IRegistry);
    function getResolver(string calldata label) external view returns (address);
    function getParent() external view returns (IRegistry parent, string memory label);
}

/// @notice The registration surface of a `PermissionedRegistry` (a tokenized, expiring registry).
///         KreditoController holds `ROLE_REGISTRAR` on kredito.eth's subregistry and calls
///         `register` to mint `<label>.kredito.eth` to the approved business wallet.
interface IStandardRegistry is IRegistry {
    function register(
        string calldata label,
        address owner,
        IRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    function setResolver(uint256 anyId, address resolver) external;
    function setSubregistry(uint256 anyId, IRegistry registry) external;
    function getExpiry(uint256 anyId) external view returns (uint64 expiry);
}

/// @notice The owner lookup we use to authorize profile edits. `latestOwnerOf` returns the current
///         ERC-1155 owner of a subname token (null if burned).
interface IPermissionedRegistry is IStandardRegistry {
    function latestOwnerOf(uint256 tokenId) external view returns (address owner);
    function getTokenId(uint256 anyId) external view returns (uint256 tokenId);
    /// @notice Grant a registry-wide (ROOT) role. ROLE_REGISTRAR must be granted via this, not
    ///         the per-resource `grantRoles` (which reverts for ROOT-only roles).
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
}

/// @notice ENSv2 `VerifiableFactory` (Sepolia 0xd2a632d8a8b67c2c4398c255cbd7af8dd7236198) — deploys a
///         UUPS proxy via CREATE2 and forwards `data` to the implementation's initializer.
/// @dev Effective CREATE2 salt = keccak256(abi.encode(msg.sender, salt)). Returns the proxy address.
interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address proxy);
}

/// @notice Initializer of the ENSv2 `UserRegistry` implementation
///         (Sepolia impl 0x0f99e7ea74903afcb7224d0354fd7428a6f92917). Grants `roleBitmap` to `admin`
///         on ROOT. hcaFactory + labelStore are baked into the implementation's constructor already.
interface IUserRegistryInit {
    function initialize(address admin, uint256 roleBitmap) external;
}

/// @notice Nybble-packed role constants from ENSv2 `RegistryRolesLib`. Admin counterpart is `<<128`.
library KreditoEnsRoles {
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;
    uint256 internal constant ROLE_RENEW = 1 << 16;
    uint256 internal constant ROLE_RENEW_ADMIN = ROLE_RENEW << 128;

    /// @notice Roles granted to the business on its own subname. We intentionally OMIT
    ///         ROLE_SET_RESOLVER and ROLE_SET_SUBREGISTRY so the owner cannot re-point resolution
    ///         and forge an "approved" status, and OMIT ROLE_CAN_TRANSFER_ADMIN to make the credit
    ///         identity soulbound. Profile edits work off ownership, not roles.
    uint256 internal constant OWNER_ROLE_BITMAP = ROLE_RENEW | ROLE_RENEW_ADMIN;
}
