// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IRegistry, IStandardRegistry, KreditoEnsRoles } from "./interfaces/IEnsV2.sol";
import { KreditoResolver } from "./KreditoResolver.sol";

/// @title KreditoController
/// @notice The issuance authority for `<label>.kredito.eth` credit identities. The backend issuer
///         (which holds the CRE / Confidential-AI-Attester result) calls `mint` directly — there is
///         NO user-relayed voucher: holding `ISSUER_ROLE` *is* the authorization, and Privy
///         sponsors the gas. The controller holds `ROLE_REGISTRAR` on kredito.eth's ENSv2
///         subregistry, so it is the only thing that can create subnames.
/// @dev Trust split:
///        - DEFAULT_ADMIN_ROLE : cold key (multisig). Rotates the issuer, tunes config.
///        - ISSUER_ROLE        : hot backend key. Mints / revokes. Rotatable on-chain if leaked.
///      The controller is the `issuer` of KreditoResolver, so it (and only it) writes the
///      issuer-locked `kredito.status` / `lendsignal.attestation` records. Businesses edit their
///      own profile records directly on the resolver (owner-gated). The private credit score never
///      touches this contract — it stays in Supabase.
contract KreditoController is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    /// @notice namehash("kredito.eth") on ENSv2 — the parent of every issued identity.
    bytes32 public parentNode;
    /// @notice kredito.eth's subregistry (a PermissionedRegistry) where this controller holds ROLE_REGISTRAR.
    IStandardRegistry public subRegistry;
    /// @notice The split-ACL resolver set on every issued subname.
    KreditoResolver public resolver;
    /// @notice Absolute expiry stamped on issued subnames (far future; only matters if kredito.eth lapses).
    uint64 public defaultExpiry;
    /// @notice Roles granted to the business on its own subname (intentionally minimal — see KreditoEnsRoles).
    uint256 public ownerRoleBitmap;

    /// @notice node => already issued (idempotency against reorgs / double-submit).
    mapping(bytes32 => bool) public issued;

    error AlreadyIssued(bytes32 node);
    error ResolverNotSet();
    error SubRegistryNotSet();

    event IdentityMinted(bytes32 indexed node, address indexed business, string label, uint256 tokenId);
    event IdentityRevoked(bytes32 indexed node, string label);
    event StatusUpdated(bytes32 indexed node, string label, string status);
    event ConfigUpdated();

    constructor(address admin, address issuer, bytes32 parentNode_, uint64 defaultExpiry_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
        parentNode = parentNode_;
        defaultExpiry = defaultExpiry_;
        ownerRoleBitmap = KreditoEnsRoles.OWNER_ROLE_BITMAP;
    }

    // ------------------------------------------------------------------------------- issuance

    /// @notice Mint `<label>.kredito.eth` to an approved business and stamp the issuer-locked
    ///         `approved` status + attestation. Caller must hold ISSUER_ROLE (the backend, only
    ///         after Supabase/CRE marks the address approved). Label MUST be ENSIP-15 normalized
    ///         off-chain before calling.
    function mint(string calldata label, address business, string calldata attestationHash)
        external
        onlyRole(ISSUER_ROLE)
        returns (uint256 tokenId, bytes32 node)
    {
        if (address(resolver) == address(0)) revert ResolverNotSet();
        if (address(subRegistry) == address(0)) revert SubRegistryNotSet();

        node = _node(label);
        if (issued[node]) revert AlreadyIssued(node);
        issued[node] = true;

        tokenId =
            subRegistry.register(label, business, IRegistry(address(0)), address(resolver), ownerRoleBitmap, defaultExpiry);
        resolver.initIdentity(node, business, "approved", attestationHash);

        emit IdentityMinted(node, business, label, tokenId);
    }

    /// @notice Flip an identity's status to "denied" (revoke-on-default). No burn — the business
    ///         keeps its name; lending authorization reads Supabase, this is the credential mirror.
    function revoke(string calldata label) external onlyRole(ISSUER_ROLE) {
        bytes32 node = _node(label);
        resolver.setStatus(node, "denied");
        emit IdentityRevoked(node, label);
    }

    /// @notice Generic issuer-only status update (e.g. "approved" -> "review" -> "denied").
    function setStatus(string calldata label, string calldata status) external onlyRole(ISSUER_ROLE) {
        bytes32 node = _node(label);
        resolver.setStatus(node, status);
        emit StatusUpdated(node, label, status);
    }

    // --------------------------------------------------------------------------------- config (admin)

    function setResolver(KreditoResolver resolver_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        resolver = resolver_;
        emit ConfigUpdated();
    }

    function setSubRegistry(IStandardRegistry subRegistry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        subRegistry = subRegistry_;
        emit ConfigUpdated();
    }

    function setParentNode(bytes32 parentNode_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        parentNode = parentNode_;
        emit ConfigUpdated();
    }

    function setDefaultExpiry(uint64 defaultExpiry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultExpiry = defaultExpiry_;
        emit ConfigUpdated();
    }

    function setOwnerRoleBitmap(uint256 ownerRoleBitmap_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ownerRoleBitmap = ownerRoleBitmap_;
        emit ConfigUpdated();
    }

    // ------------------------------------------------------------------------------------- views

    /// @notice ENSv2 namehash of `<label>.kredito.eth` = keccak256(parentNode, keccak256(label)).
    function nodeOf(string calldata label) external view returns (bytes32) {
        return _node(label);
    }

    function _node(string calldata label) private view returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }
}
