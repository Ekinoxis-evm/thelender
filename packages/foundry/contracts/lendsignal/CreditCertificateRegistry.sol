// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { CreditTypes } from "./libraries/CreditTypes.sol";
import { CreditMetadata } from "./libraries/CreditMetadata.sol";
import { ICreditCertificateRegistry } from "./interfaces/ICreditCertificateRegistry.sol";
import { IENSRegistry, IAddrResolver, ITextResolver } from "./interfaces/IENS.sol";

/// @title CreditCertificateRegistry
/// @author LendSignal
/// @notice Onchain hub that CENTRALIZES the offchain credit signals (Chainlink Confidential
///         AI + offchain CRS bureau), DEFINES the per-user score, GATES eligibility on an
///         ENS identity, and mints each certificate as a SOULBOUND NFT (ERC-5192) with
///         fully onchain dynamic art.
///
///         Information enters through one trusted path: the issuer (LendSignal backend /
///         Chainlink CRE) signs `issueCertificate` and `linkEns`. The contract blends the
///         scores into `combinedScore`, derives the risk tier, stores an updateable
///         certificate, and verifies the ENS identity onchain. Lending contracts read
///         `isEligible`. Raw private evidence never touches this contract.
contract CreditCertificateRegistry is ICreditCertificateRegistry, ERC721, Ownable {
    // --- Roles ---
    /// @notice The only address allowed to write certificates (backend / CRE signer).
    address public issuer;

    // --- Score policy (owner-tunable) ---
    uint16 public aiWeightBps = 7000; // 70% Confidential AI (Chainlink)
    uint16 public bureauWeightBps = 3000; // 30% CRS bureau (offchain)
    uint256 public minEligibleScore = 750;

    // --- ENS gate config (owner-tunable) ---
    IENSRegistry public ens; // address(0) = not configured
    bool public ensGateEnabled;
    bool public requireAttestationRecord;
    string public constant ATTESTATION_KEY = "lendsignal.attestation";

    // --- Storage ---
    mapping(address => CreditTypes.CreditCertificate) private _certificates;
    address[] private _borrowers;

    /// @notice One soulbound token per business wallet; 0 = none.
    mapping(address => uint256) public tokenIdOf;
    uint256 private _nextTokenId;

    // --- Errors ---
    error NotIssuer();
    error ZeroAddress();
    error InvalidScore();
    error InvalidExpiry();
    error InvalidWeights();
    error AlreadyCertified();
    error NotCertified();
    error InvalidEnsNode();
    error Soulbound();

    // --- ERC-5192 ---
    event Locked(uint256 tokenId);

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(address _issuer) ERC721("LendSignal Credit Certificate", "LSCC") Ownable(msg.sender) {
        if (_issuer == address(0)) revert ZeroAddress();
        issuer = _issuer;
        emit IssuerUpdated(address(0), _issuer);
    }

    // ---------------------------------------------------------------------
    // Writes — the data-entry path (issuer-gated)
    // ---------------------------------------------------------------------

    function issueCertificate(address borrower, CreditTypes.ScoreInputs calldata inputs) external onlyIssuer {
        _validate(borrower, inputs);
        if (_certificates[borrower].status != CreditTypes.Status.None) revert AlreadyCertified();

        uint256 combined = _combine(inputs);
        CreditTypes.RiskTier tier = CreditTypes.tierForScore(combined);

        _certificates[borrower] = CreditTypes.CreditCertificate({
            confidentialAiScore: inputs.confidentialAiScore,
            bureauScore: inputs.bureauScore,
            combinedScore: combined,
            riskTier: tier,
            attestationHash: inputs.attestationHash,
            bureauReportHash: inputs.bureauReportHash,
            evidenceDigest: inputs.evidenceDigest,
            ensName: "",
            ensNode: bytes32(0),
            status: CreditTypes.Status.Active,
            issuedAt: block.timestamp,
            expiresAt: inputs.expiresAt,
            lastUpdatedAt: block.timestamp,
            version: 1
        });

        // First-time certification: index the borrower and mint the soulbound NFT.
        _borrowers.push(borrower);
        uint256 tokenId = ++_nextTokenId;
        tokenIdOf[borrower] = tokenId;
        _mint(borrower, tokenId);
        emit Locked(tokenId);

        emit SignalsRecorded(
            borrower,
            inputs.confidentialAiScore,
            inputs.bureauScore,
            inputs.attestationHash,
            inputs.bureauReportHash,
            inputs.evidenceDigest
        );
        emit CertificateIssued(borrower, combined, tier, inputs.attestationHash, inputs.expiresAt);
    }

    function updateCertificate(address borrower, CreditTypes.ScoreInputs calldata inputs) external onlyIssuer {
        _validate(borrower, inputs);
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status == CreditTypes.Status.None) revert NotCertified();

        uint256 combined = _combine(inputs);
        CreditTypes.RiskTier tier = CreditTypes.tierForScore(combined);

        cert.confidentialAiScore = inputs.confidentialAiScore;
        cert.bureauScore = inputs.bureauScore;
        cert.combinedScore = combined;
        cert.riskTier = tier;
        cert.attestationHash = inputs.attestationHash;
        cert.bureauReportHash = inputs.bureauReportHash;
        cert.evidenceDigest = inputs.evidenceDigest;
        cert.status = CreditTypes.Status.Active;
        cert.expiresAt = inputs.expiresAt;
        cert.lastUpdatedAt = block.timestamp;
        cert.version += 1;

        emit SignalsRecorded(
            borrower,
            inputs.confidentialAiScore,
            inputs.bureauScore,
            inputs.attestationHash,
            inputs.bureauReportHash,
            inputs.evidenceDigest
        );
        emit CertificateUpdated(borrower, combined, tier, cert.version);
    }

    function linkEns(address borrower, string calldata ensName, bytes32 ensNode) external onlyIssuer {
        if (ensNode == bytes32(0)) revert InvalidEnsNode();
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status == CreditTypes.Status.None) revert NotCertified();
        cert.ensName = ensName;
        cert.ensNode = ensNode;
        cert.lastUpdatedAt = block.timestamp;
        emit EnsLinked(borrower, ensName, ensNode);
    }

    function revokeCertificate(address borrower) external onlyIssuer {
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status == CreditTypes.Status.None) revert NotCertified();
        cert.status = CreditTypes.Status.Revoked;
        cert.lastUpdatedAt = block.timestamp;
        emit CertificateRevoked(borrower);
    }

    function markDefault(address borrower) external onlyIssuer {
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status == CreditTypes.Status.None) revert NotCertified();
        cert.status = CreditTypes.Status.Defaulted;
        cert.lastUpdatedAt = block.timestamp;
        emit CertificateDefaulted(borrower);
    }

    // ---------------------------------------------------------------------
    // Views — credit
    // ---------------------------------------------------------------------

    function getCertificate(address borrower) external view returns (CreditTypes.CreditCertificate memory) {
        return _certificates[borrower];
    }

    function statusOf(address borrower) public view returns (CreditTypes.Status) {
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status == CreditTypes.Status.Active && block.timestamp >= cert.expiresAt) {
            return CreditTypes.Status.Expired;
        }
        return cert.status;
    }

    function combinedScoreOf(address borrower) external view returns (uint256) {
        return _certificates[borrower].combinedScore;
    }

    function riskTierOf(address borrower) external view returns (CreditTypes.RiskTier) {
        return _certificates[borrower].riskTier;
    }

    function isEligible(address borrower) external view returns (bool) {
        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        if (cert.status != CreditTypes.Status.Active) return false;
        if (block.timestamp >= cert.expiresAt) return false;
        if (cert.combinedScore < minEligibleScore) return false;
        if (cert.riskTier == CreditTypes.RiskTier.High) return false;
        if (ensGateEnabled && !_ensOk(borrower)) return false;
        return true;
    }

    function borrowersCount() external view returns (uint256) {
        return _borrowers.length;
    }

    function borrowerAt(uint256 index) external view returns (address) {
        return _borrowers[index];
    }

    // ---------------------------------------------------------------------
    // Views — ENS
    // ---------------------------------------------------------------------

    function isEnsVerified(address borrower) external view returns (bool) {
        return _ensOk(borrower);
    }

    /// @notice The exact value the `lendsignal.attestation` ENS text record must hold:
    ///         the 0x-prefixed lowercase hex of the certificate's attestation hash.
    function attestationRecord(bytes32 hash) public pure returns (string memory) {
        return Strings.toHexString(uint256(hash), 32);
    }

    // ---------------------------------------------------------------------
    // Soulbound NFT
    // ---------------------------------------------------------------------

    /// @notice Fully onchain dynamic metadata reflecting the live certificate state.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        address holder = ownerOf(tokenId);
        return CreditMetadata.tokenURI(_certificates[holder], holder, tokenId, statusOf(holder));
    }

    /// @notice ERC-5192: every token is permanently locked (soulbound).
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId); // ERC-5192
    }

    /// @dev Soulbound: allow mint (from == 0) and burn (to == 0), block transfers.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setIssuer(address newIssuer) external onlyOwner {
        if (newIssuer == address(0)) revert ZeroAddress();
        emit IssuerUpdated(issuer, newIssuer);
        issuer = newIssuer;
    }

    function setWeights(uint16 _aiWeightBps, uint16 _bureauWeightBps) external onlyOwner {
        if (uint256(_aiWeightBps) + uint256(_bureauWeightBps) != CreditTypes.BPS_DENOMINATOR) {
            revert InvalidWeights();
        }
        aiWeightBps = _aiWeightBps;
        bureauWeightBps = _bureauWeightBps;
        emit WeightsUpdated(_aiWeightBps, _bureauWeightBps);
    }

    function setMinEligibleScore(uint256 newMin) external onlyOwner {
        emit MinEligibleScoreUpdated(minEligibleScore, newMin);
        minEligibleScore = newMin;
    }

    function setEnsRegistry(address ensRegistry) external onlyOwner {
        ens = IENSRegistry(ensRegistry);
        emit EnsRegistryUpdated(ensRegistry);
    }

    function setEnsGateEnabled(bool enabled) external onlyOwner {
        ensGateEnabled = enabled;
        emit EnsGateUpdated(enabled, requireAttestationRecord);
    }

    function setRequireAttestationRecord(bool required) external onlyOwner {
        requireAttestationRecord = required;
        emit EnsGateUpdated(ensGateEnabled, required);
    }

    // ---------------------------------------------------------------------
    // Internal — scoring
    // ---------------------------------------------------------------------

    function _validate(address borrower, CreditTypes.ScoreInputs calldata inputs) private view {
        if (borrower == address(0)) revert ZeroAddress();
        if (inputs.confidentialAiScore > CreditTypes.MAX_SCORE || inputs.bureauScore > CreditTypes.MAX_SCORE) {
            revert InvalidScore();
        }
        if (inputs.expiresAt <= block.timestamp) revert InvalidExpiry();
    }

    function _combine(CreditTypes.ScoreInputs calldata inputs) private view returns (uint256) {
        return CreditTypes.combineScore(inputs.confidentialAiScore, inputs.bureauScore, aiWeightBps, bureauWeightBps);
    }

    // ---------------------------------------------------------------------
    // Internal — ENS resolution (the gate)
    // ---------------------------------------------------------------------

    function _ensOk(address borrower) private view returns (bool) {
        if (address(ens) == address(0)) return true;

        CreditTypes.CreditCertificate storage cert = _certificates[borrower];
        bytes32 node = cert.ensNode;
        if (node == bytes32(0)) return false;

        address resolverAddr = ens.resolver(node);
        if (resolverAddr == address(0)) return false;

        try IAddrResolver(resolverAddr).addr(node) returns (address payable resolved) {
            if (resolved != borrower) return false;
        } catch {
            return false;
        }

        if (requireAttestationRecord) {
            try ITextResolver(resolverAddr).text(node, ATTESTATION_KEY) returns (string memory rec) {
                if (keccak256(bytes(rec)) != keccak256(bytes(attestationRecord(cert.attestationHash)))) {
                    return false;
                }
            } catch {
                return false;
            }
        }

        return true;
    }
}
