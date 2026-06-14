// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { CreditTypes } from "../libraries/CreditTypes.sol";

/// @title ICreditCertificateRegistry
/// @notice Read/write surface of the LendSignal credit certificate registry: centralizes
///         the offchain credit signals, defines the per-user score, and gates eligibility
///         on an ENS identity. Lending contracts consume it through `isEligible`.
interface ICreditCertificateRegistry {
    // --- Credit events ---
    event CertificateIssued(
        address indexed borrower,
        uint256 combinedScore,
        CreditTypes.RiskTier riskTier,
        bytes32 attestationHash,
        uint256 expiresAt
    );
    event CertificateUpdated(
        address indexed borrower, uint256 combinedScore, CreditTypes.RiskTier riskTier, uint64 version
    );
    event CertificateRevoked(address indexed borrower);
    event CertificateDefaulted(address indexed borrower);
    event SignalsRecorded(
        address indexed borrower,
        uint256 confidentialAiScore,
        uint256 bureauScore,
        bytes32 attestationHash,
        bytes32 bureauReportHash,
        bytes32 evidenceDigest
    );
    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event WeightsUpdated(uint16 aiWeightBps, uint16 bureauWeightBps);
    event MinEligibleScoreUpdated(uint256 previous, uint256 current);

    // --- ENS events ---
    event EnsLinked(address indexed borrower, string ensName, bytes32 ensNode);
    event EnsRegistryUpdated(address indexed ensRegistry);
    event EnsGateUpdated(bool enabled, bool requireAttestationRecord);

    // --- Writes (issuer-gated) ---
    function issueCertificate(address borrower, CreditTypes.ScoreInputs calldata inputs) external;
    function updateCertificate(address borrower, CreditTypes.ScoreInputs calldata inputs) external;
    function revokeCertificate(address borrower) external;
    function markDefault(address borrower) external;
    function linkEns(address borrower, string calldata ensName, bytes32 ensNode) external;

    // --- Views ---
    function getCertificate(address borrower) external view returns (CreditTypes.CreditCertificate memory);
    function statusOf(address borrower) external view returns (CreditTypes.Status);
    function combinedScoreOf(address borrower) external view returns (uint256);
    function riskTierOf(address borrower) external view returns (CreditTypes.RiskTier);
    function isEnsVerified(address borrower) external view returns (bool);
    function isEligible(address borrower) external view returns (bool);
    function attestationRecord(bytes32 hash) external pure returns (string memory);
    function borrowersCount() external view returns (uint256);
}
