/**
 * LendSignal shared types — the canonical shape of what a business submits, what
 * the Chainlink Confidential AI Attester returns, and the score payload that
 * becomes `ScoreInputs` onchain.
 *
 * The score is 100% the Confidential AI score (computed in the TEE over the
 * borrower's own documents). There is NO mock bureau and NO demo/synthetic data.
 */

export type RiskBand = "low" | "medium" | "high";

export type RiskTier = "low_default_risk" | "medium_default_risk" | "high_default_risk";

/** What the borrower fills in on the onboarding form. */
export type BusinessProfile = {
  legalName: string;
  country: string;
  /** Legal entity type (LLC, Corporation, …) — see lib/countries ENTERPRISE_TYPES. */
  enterpriseType: string;
  /** Government tax identification number. */
  taxNumber: string;
  /** Company registry / incorporation number. */
  registryNumber: string;
  // Legacy optional fields (no longer collected by the onboarding form; kept for prompt compatibility).
  dbaName?: string;
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
};

/** A document attached to the inference request (base64, ≤10 MiB each, ≤10 total). */
export type UploadedDocument = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

export type DocumentSignal = "positive" | "neutral" | "negative";

/** Final underwriting decision over the full document set. */
export type CreditDecision = "approved" | "manual_review" | "denied";

/**
 * Per-document structured analysis — the model assesses EACH file one by one and
 * decides whether it is reliable and truthful (authenticity + consistency), then
 * these summaries are reduced into the final decision.
 */
export type DocumentAnalysis = {
  filename: string;
  documentType: string;
  /** Was the document provided and readable. */
  present: boolean;
  /** Looks like a genuine document. */
  authenticity: RiskBand;
  /** Internal/cross-document consistency (veracity). */
  consistency: RiskBand;
  /** Overall: trustworthy enough to underwrite on. */
  reliable: boolean;
  finding: string;
  signal: DocumentSignal;
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
  /** Final underwriting decision reduced from the per-document analysis. */
  decision: CreditDecision;
  /** Per-document breakdown (one entry per attached file). */
  document_analysis: DocumentAnalysis[];
  reasoning_summary: string;
  missing_information: string[];
};

/**
 * The score payload, 1:1 with `CreditTypes.ScoreInputs` in Solidity. The next
 * step (onchain issuance) passes exactly this to `registry.issueCertificate`.
 */
export type ScoreInputs = {
  confidentialAiScore: number;
  attestationHash: `0x${string}`;
  evidenceDigest: `0x${string}`;
  /** Unix seconds. */
  expiresAt: number;
};

/** One Confidential AI query in the pipeline (a section or the reduce). */
export type InferenceRef = {
  label: string;
  inferenceId: string;
  attested: boolean;
};

/** Full response of POST /api/lendsignal/score — everything the UI renders. */
export type ScoreResult = {
  /** Confidential AI request id (the on-record proof of the inference). */
  inferenceId: string;
  model: string;
  /** true → a real attested inference ran inside the Chainlink TEE. */
  attested: boolean;
  confidentialAi: ConfidentialAiResult;
  /** The credit score (equals the Confidential AI score). */
  combinedScore: number;
  riskTier: RiskTier;
  /** combinedScore >= minEligibleScore && tier != high. */
  eligible: boolean;
  minEligibleScore: number;
  scoreInputs: ScoreInputs;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** Every Confidential AI query that ran (per-section + reduce), with ids. */
  inferences?: InferenceRef[];
};
