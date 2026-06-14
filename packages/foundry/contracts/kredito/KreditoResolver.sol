// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IExtendedResolver } from "./interfaces/IEnsV2.sol";

/// @title KreditoResolver
/// @notice The ENSv2 resolver for `<label>.kredito.eth` credit identities. It serves two record
///         classes with different write authority:
///           - ISSUER-LOCKED keys (`kredito.status`, `lendsignal.attestation`) — only the issuer
///             may write them. This is the tamper-evident "approved/denied" credential.
///           - PROFILE keys (`url`, `com.twitter`, `avatar`, `name`, ...) — only the subname's
///             owner (the business) may write them.
///         The private credit *score* never lives here; it stays in Supabase.
/// @dev Reads happen through the ENSv2 UniversalResolver, which calls `resolve()` (ENSIP-10) after
///      checking we advertise interface id `0x9061b923`. The inner `data` carries the namehash
///      `node`; we key all records by that same `node` (set by the controller at mint time).
///
///      SECURITY: the business owns its subname token, but we withhold `ROLE_SET_RESOLVER` on it
///      (see KreditoEnsRoles.OWNER_ROLE_BITMAP), so it cannot re-point resolution to a resolver it
///      controls and forge "approved". The card should also pin reads to this contract's address.
contract KreditoResolver is IExtendedResolver {
    // --- resolver profile selectors (legacy-compatible, the inner calls UniversalResolver sends) ---
    bytes4 private constant SEL_ADDR = 0x3b3b57de; // addr(bytes32)
    bytes4 private constant SEL_ADDR_COIN = 0xf1cb7e06; // addr(bytes32,uint256)
    bytes4 private constant SEL_TEXT = 0x59d1d43c; // text(bytes32,string)

    // --- ERC-165 interface ids ---
    bytes4 private constant IID_ERC165 = 0x01ffc9a7;
    bytes4 private constant IID_EXTENDED_RESOLVER = 0x9061b923; // IExtendedResolver (ENSIP-10)
    bytes4 private constant IID_ADDR = 0x3b3b57de;
    bytes4 private constant IID_ADDR_COIN = 0xf1cb7e06;
    bytes4 private constant IID_TEXT = 0x59d1d43c;

    uint256 private constant COINTYPE_ETH = 60;

    // --- issuer-locked keys ---
    bytes32 private constant KEY_STATUS = keccak256(bytes("kredito.status"));
    bytes32 private constant KEY_ATTESTATION = keccak256(bytes("lendsignal.attestation"));

    // --- roles ---
    address public admin; // can rotate the issuer (cold key in prod)
    address public issuer; // the KreditoController / backend issuer (hot)

    // --- records, keyed by ENSv2 node (namehash of <label>.kredito.eth) ---
    mapping(bytes32 => address) public nameOwner; // node => business wallet (set at mint)
    mapping(bytes32 => address) private _ethAddr; // node => EVM address (coinType 60)
    mapping(bytes32 => mapping(string => string)) private _texts; // node => key => value

    error NotAdmin();
    error NotIssuer();
    error NotOwner();
    error AlreadyInitialized();
    error UnsupportedResolverProfile(bytes4 selector);

    event IssuerUpdated(address indexed issuer);
    event IdentityInitialized(bytes32 indexed node, address indexed owner);
    event AddrChanged(bytes32 indexed node, address addr);
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);

    constructor(address admin_, address issuer_) {
        admin = admin_;
        issuer = issuer_;
        emit IssuerUpdated(issuer_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    function setIssuer(address issuer_) external onlyAdmin {
        issuer = issuer_;
        emit IssuerUpdated(issuer_);
    }

    // ------------------------------------------------------------------ issuance / locked records

    /// @notice Called once by the issuer (KreditoController) at mint: binds the node to its owner,
    ///         points `addr` at the owner, and writes the issuer-locked status + attestation.
    function initIdentity(bytes32 node, address owner_, string calldata status, string calldata attestation)
        external
        onlyIssuer
    {
        if (nameOwner[node] != address(0)) revert AlreadyInitialized();
        nameOwner[node] = owner_;
        _ethAddr[node] = owner_;
        _texts[node]["kredito.status"] = status;
        _texts[node]["lendsignal.attestation"] = attestation;
        emit IdentityInitialized(node, owner_);
        emit AddrChanged(node, owner_);
        emit TextChanged(node, "kredito.status", "kredito.status", status);
        emit TextChanged(node, "lendsignal.attestation", "lendsignal.attestation", attestation);
    }

    /// @notice Issuer-only status update (e.g. revoke-on-default → "denied"). No burn.
    function setStatus(bytes32 node, string calldata status) external onlyIssuer {
        _texts[node]["kredito.status"] = status;
        emit TextChanged(node, "kredito.status", "kredito.status", status);
    }

    // ------------------------------------------------------------------------- writes (split ACL)

    /// @notice Set a text record. Issuer-locked keys require the issuer; all other keys require the
    ///         subname owner. Unknown keys default to OWNER-only (never "anyone").
    function setText(bytes32 node, string calldata key, string calldata value) external {
        bytes32 kh = keccak256(bytes(key));
        if (kh == KEY_STATUS || kh == KEY_ATTESTATION) {
            if (msg.sender != issuer) revert NotIssuer();
        } else {
            if (msg.sender != nameOwner[node]) revert NotOwner();
        }
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    /// @notice Update the EVM address record. Owner or issuer.
    function setAddr(bytes32 node, address a) external {
        if (msg.sender != nameOwner[node] && msg.sender != issuer) revert NotOwner();
        _ethAddr[node] = a;
        emit AddrChanged(node, a);
    }

    // ------------------------------------------------------------------------------------- reads

    function addr(bytes32 node) public view returns (address) {
        return _ethAddr[node];
    }

    function text(bytes32 node, string calldata key) public view returns (string memory) {
        return _texts[node][key];
    }

    /// @notice ENSIP-10 entrypoint used by the UniversalResolver / viem. Decodes the inner profile
    ///         call from `data` and returns its ABI-encoded result. `name` (DNS-encoded) is unused:
    ///         the `node` in `data` is authoritative for our L1 names.
    function resolve(bytes calldata, bytes calldata data) external view override returns (bytes memory) {
        bytes4 selector = bytes4(data[:4]);

        if (selector == SEL_ADDR) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return abi.encode(_ethAddr[node]);
        }
        if (selector == SEL_TEXT) {
            (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
            return abi.encode(_texts[node][key]);
        }
        if (selector == SEL_ADDR_COIN) {
            (bytes32 node, uint256 coinType) = abi.decode(data[4:], (bytes32, uint256));
            if (coinType == COINTYPE_ETH) {
                return abi.encode(_addressToBytes(_ethAddr[node]));
            }
            return abi.encode(bytes(""));
        }
        revert UnsupportedResolverProfile(selector);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == IID_ERC165 || interfaceId == IID_EXTENDED_RESOLVER || interfaceId == IID_ADDR
            || interfaceId == IID_ADDR_COIN || interfaceId == IID_TEXT;
    }

    function _addressToBytes(address a) private pure returns (bytes memory b) {
        b = new bytes(20);
        assembly {
            mstore(add(b, 32), shl(96, a))
        }
    }
}
