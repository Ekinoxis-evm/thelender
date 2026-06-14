/**
 * LendSignal shared types — the canonical shape of what a business submits, what
 * the Chainlink Confidential AI Attester returns, what the (mock) CRS bureau
 * returns, and the blended score payload that becomes `ScoreInputs` onchain.
 *
 * These mirror `packages/foundry/contracts/lendsignal/libraries/CreditTypes.sol`
 * so the score the UI shows equals the `combinedScore` the registry computes.
 */

export type RiskBand = "low" | "medium" | "high";

export type RiskTier = "low_default_risk" | "medium_default_risk" | "high_default_risk";

/** What the borrower fills in on /onboarding. */
export type BusinessProfile = {
  legalName: string;
  dbaName?: string;
  country: string;
  state?: string;
  city?: string;
  address?: string;
  taxIdLast4?: string;
  industry?: string;
  ownerOrPrincipal?: {
    name: string;
    role: string;
    ownershipPct?: number;
  };
  requestedLoanUsd?: number;
  /** Optional ENS name the business links to its credit identity (Feature 5). */
  ensName?: string;
};

/** A document attached to the inference request (base64, ≤10 MiB each, ≤10 total). */
export type UploadedDocument = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

/** Strict JSON the Confidential AI Attester is asked to return (see prompt.ts). */
export type ConfidentialAiResult = {
  business_verified: boolean;
  document_authenticity: RiskBand;
  fraud_risk: RiskBand;
  cashflow_strength: RiskBand;
  debt_capacity: RiskBand;
  /** 0..1000 creditworthiness. */
  creditworthiness_score: number;
  risk_tier: RiskTier;
  reasoning_summary: string;
  missing_information: string[];
};

/** Normalized CRS credit-bureau signal (Feature 3). Real CRS later, mock now. */
export type CreditBureauSignal = {
  provider: "crs_mock" | "crs";
  reportId: string;
  businessVerified: boolean;
  principalMatched: boolean;
  /** 0..1000 to match the onchain score scale. */
  bureauScore: number;
  paymentRisk: RiskBand;
  fraudRisk: RiskBand;
  publicRecordsRisk: RiskBand;
  recommendedCreditLimitUsd: number;
  delinquencyRisk12mo: number;
  adverseSignals: string[];
  positiveSignals: string[];
  rawReportHash: `0x${string}`;
  pulledAt: string;
};

/**
 * The blended payload, 1:1 with `CreditTypes.ScoreInputs` in Solidity. The next
 * step (onchain issuance) passes exactly this to `registry.issueCertificate`.
 */
export type ScoreInputs = {
  confidentialAiScore: number;
  bureauScore: number;
  attestationHash: `0x${string}`;
  bureauReportHash: `0x${string}`;
  evidenceDigest: `0x${string}`;
  /** Unix seconds. */
  expiresAt: number;
};

/** Full response of POST /api/lendsignal/score — everything the UI renders. */
export type ScoreResult = {
  /** Confidential AI request id (the on-record proof of the inference). */
  inferenceId: string;
  model: string;
  /**
   * true  → a real attested inference ran inside the Chainlink TEE.
   * false → mock fallback (no API key configured); the flow still works for dev.
   */
  attested: boolean;
  confidentialAi: ConfidentialAiResult;
  bureau: CreditBureauSignal;
  /** Blended 70/30 score, floored to match Solidity integer math. */
  combinedScore: number;
  riskTier: RiskTier;
  /** combinedScore >= minEligibleScore && tier != high. */
  eligible: boolean;
  minEligibleScore: number;
  weights: { aiBps: number; bureauBps: number };
  scoreInputs: ScoreInputs;
  usage?: { prompt_tokens: number; completion_tokens: number };
};
