/**
 * Score combiner — the score is 100% the Confidential AI score computed inside the
 * Chainlink TEE over the borrower's own documents. There is no bureau blend and no
 * synthetic fallback: if a section/reduce inference fails or returns unparseable
 * output, parsing THROWS a clear Error and the caller surfaces it to the user.
 *
 *   >=750 Low · 600..749 Medium · <600 High   ·   eligible = >=600 && tier!=High
 */
import type { InferenceSnapshot } from "./confidentialAi";
import type {
  ConfidentialAiResult,
  CreditDecision,
  DocumentAnalysis,
  DocumentSignal,
  InferenceRef,
  RiskBand,
  RiskTier,
  ScoreInputs,
  ScoreResult,
} from "./types";
import { keccak256, stringToBytes } from "viem";

export const MIN_ELIGIBLE_SCORE = 600;
export const CERTIFICATE_VALIDITY_SECONDS = 90 * 24 * 60 * 60; // 90 days

const clampScore = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));

export function tierFromScore(score: number): RiskTier {
  if (score >= 750) return "low_default_risk";
  if (score >= 600) return "medium_default_risk";
  return "high_default_risk";
}

export function decisionForScore(score: number): CreditDecision {
  if (score >= 750) return "approved";
  if (score >= 600) return "manual_review";
  return "denied";
}

/**
 * Parse one per-section inference into a document entry + its section score.
 * Throws if the model output is missing or unparseable — no synthetic fallback.
 */
export function parseSectionOutput(
  output: string | undefined,
  documentType: string,
  filename: string,
): { docAnalysis: DocumentAnalysis; sectionScore: number } {
  const parsed = tryExtractJson(output);
  if (!parsed) {
    throw new Error(`Credit analysis failed — the model returned no parseable result for ${filename}.`);
  }
  return {
    docAnalysis: {
      filename,
      documentType: String(parsed.document_type ?? documentType).slice(0, 80),
      present: parsed.present === undefined ? true : Boolean(parsed.present),
      authenticity: asBand(parsed.authenticity),
      consistency: asBand(parsed.consistency),
      reliable: parsed.reliable === undefined ? true : Boolean(parsed.reliable),
      finding: String(parsed.finding ?? "").slice(0, 240),
      signal: asSignal(parsed.signal),
    },
    sectionScore: clampScore(Number(parsed.section_score ?? 0)),
  };
}

/**
 * Reduce the per-section analyses into the overall credit result.
 * Throws if the reduce output is missing or unparseable — no synthetic fallback.
 */
export function parseReduceOutput(
  output: string | undefined,
  documentAnalysis: DocumentAnalysis[],
  avgSectionScore: number,
): ConfidentialAiResult {
  const parsed = tryExtractJson(output);
  if (!parsed) {
    throw new Error("Credit analysis failed — the model returned no parseable final decision. Please retry.");
  }
  const score = clampScore(Number(parsed.creditworthiness_score ?? avgSectionScore));
  return {
    business_verified: Boolean(parsed.business_verified),
    document_authenticity: asBand(parsed.document_authenticity),
    fraud_risk: asBand(parsed.fraud_risk),
    cashflow_strength: asBand(parsed.cashflow_strength),
    debt_capacity: asBand(parsed.debt_capacity),
    creditworthiness_score: score,
    risk_tier: tierFromScore(score),
    decision: decisionForScore(score),
    document_analysis: documentAnalysis,
    reasoning_summary: String(parsed.reasoning_summary ?? "").slice(0, 1000),
    missing_information: Array.isArray(parsed.missing_information)
      ? parsed.missing_information.map(String).slice(0, 12)
      : [],
  };
}

type ScoreResultArgs = {
  inferenceId: string;
  model: string;
  attested: boolean;
  ai: ConfidentialAiResult;
  snapshot?: InferenceSnapshot;
  documentsBase64: string[];
  nowSeconds: number;
  inferences?: InferenceRef[];
};

/** Assemble the full ScoreResult, including the onchain-ready `ScoreInputs`. */
export function buildScoreResult({
  inferenceId,
  model,
  attested,
  ai,
  snapshot,
  documentsBase64,
  nowSeconds,
  inferences,
}: ScoreResultArgs): ScoreResult {
  const aiScore = clampScore(ai.creditworthiness_score);
  const combinedScore = aiScore;
  const riskTier = tierFromScore(combinedScore);

  const attestationHash = keccak256(stringToBytes(JSON.stringify({ inferenceId, model, output: ai })));
  const evidenceDigest = computeEvidenceDigest(snapshot, documentsBase64);

  const scoreInputs: ScoreInputs = {
    confidentialAiScore: aiScore,
    attestationHash,
    evidenceDigest,
    expiresAt: nowSeconds + CERTIFICATE_VALIDITY_SECONDS,
  };

  return {
    inferenceId,
    model,
    attested,
    confidentialAi: ai,
    combinedScore,
    riskTier,
    eligible: combinedScore >= MIN_ELIGIBLE_SCORE && riskTier !== "high_default_risk",
    minEligibleScore: MIN_ELIGIBLE_SCORE,
    scoreInputs,
    usage: snapshot?.usage,
    ...(inferences && inferences.length ? { inferences } : {}),
  };
}

/** Prefer the TEE's own resource digests; otherwise hash the document bytes. */
function computeEvidenceDigest(snapshot: InferenceSnapshot | undefined, documentsBase64: string[]): `0x${string}` {
  const digests = snapshot?.resources?.map(r => r.response_digest ?? r.digest ?? "").filter(Boolean) ?? [];
  const material = digests.length > 0 ? digests.join("|") : documentsBase64.join("|");
  return keccak256(stringToBytes(material || "no-evidence"));
}

function asBand(v: unknown): RiskBand {
  return v === "low" || v === "medium" || v === "high" ? v : "medium";
}

function asSignal(v: unknown): DocumentSignal {
  return v === "positive" || v === "neutral" || v === "negative" ? v : "neutral";
}

function tryExtractJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
