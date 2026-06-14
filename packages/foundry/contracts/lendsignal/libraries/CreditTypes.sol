// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CreditTypes
/// @notice Shared types for the LendSignal onchain credit layer.
/// @dev Canonical description of *what information enters the chain* and *how the per-user
///      score is structured*.
///
///      PHASE 1 score sources (wallet-behavior signal intentionally out of scope for now):
///        1. Chainlink Confidential AI Attester   (the "CRI" signal)
///        2. Offchain credit-risk bureau (CRS)    (the offchain signal)
///
///      Privacy boundary: raw documents, KYC/KYB and full bureau reports NEVER go onchain.
///      Only the normalized component scores, the derived combined score, the risk band and
///      content hashes/digests are published.
library CreditTypes {
    enum RiskTier {
        High, // 0 -> "high_default_risk"   (score    0-599)
        Medium, // 1 -> "medium_default_risk" (score  600-749)
        Low // 2 -> "low_default_risk"    (score 750-1000)
    }

    enum Status {
        None,
        Pending,
        Active,
        Expired,
        Revoked,
        Defaulted
    }

    /// @notice Canonical INPUT payload produced offchain by the Score Combiner / CRE flow.
    struct ScoreInputs {
        uint256 confidentialAiScore; // Chainlink Confidential AI Attester (0..1000)
        uint256 bureauScore; // offchain CRS credit-risk bureau (0..1000)
        bytes32 attestationHash; // digest of the attester output
        bytes32 bureauReportHash; // digest of the raw CRS report (kept offchain)
        bytes32 evidenceDigest; // digest over the evidence resource set
        uint256 expiresAt; // unix expiry
    }

    /// @notice Stored, updateable onchain credit certificate for a business wallet.
    struct CreditCertificate {
        uint256 confidentialAiScore;
        uint256 bureauScore;
        uint256 combinedScore;
        RiskTier riskTier;
        bytes32 attestationHash;
        bytes32 bureauReportHash;
        bytes32 evidenceDigest;
        string ensName; // e.g. "acme-business.eth"
        bytes32 ensNode; // namehash of ensName (precomputed offchain)
        Status status;
        uint256 issuedAt;
        uint256 expiresAt;
        uint256 lastUpdatedAt;
        uint64 version;
    }

    uint256 internal constant MAX_SCORE = 1000;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant LOW_RISK_FLOOR = 750;
    uint256 internal constant MEDIUM_RISK_FLOOR = 600;

    function tierForScore(uint256 score) internal pure returns (RiskTier) {
        if (score >= LOW_RISK_FLOOR) return RiskTier.Low;
        if (score >= MEDIUM_RISK_FLOOR) return RiskTier.Medium;
        return RiskTier.High;
    }

    /// @notice Blend the two component scores. Weights are bps and MUST sum to 10_000.
    function combineScore(uint256 aiScore, uint256 bureauScore, uint16 aiWeightBps, uint16 bureauWeightBps)
        internal
        pure
        returns (uint256)
    {
        return (aiScore * aiWeightBps + bureauScore * bureauWeightBps) / BPS_DENOMINATOR;
    }
}
