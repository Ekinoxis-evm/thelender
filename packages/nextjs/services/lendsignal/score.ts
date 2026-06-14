/**
 * Score combiner — blends the Confidential AI score and the CRS bureau score the
 * SAME way the onchain registry does, so the UI number equals the future
 * `combinedScore`. Mirrors CreditTypes.sol:
 *   combined = (ai * 7000 + bureau * 3000) / 10000   (integer floor)
 *   >=750 Low · 600..749 Medium · <600 High   ·   eligible = >=750 && tier!=High
 */
import type { InferenceSnapshot } from "./confidentialAi";
import type { BorrowerStrength } from "./creditBureau";
import type { ConfidentialAiResult, CreditBureauSignal, RiskBand, RiskTier, ScoreInputs, ScoreResult } from "./types";
import { keccak256, stringToBytes } from "viem";

export const AI_WEIGHT_BPS = 7000;
export const BUREAU_WEIGHT_BPS = 3000;
export const BPS_DENOMINATOR = 10_000;
export const MIN_ELIGIBLE_SCORE = 750;
export const CERTIFICATE_VALIDITY_SECONDS = 90 * 24 * 60 * 60; // 90 days

const clampScore = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));

export function tierFromScore(score: number): RiskTier {
  if (score >= 750) return "low_default_risk";
  if (score >= 600) return "medium_default_risk";
  return "high_default_risk";
}

export function combineScore(aiScore: number, bureauScore: number): number {
  return Math.floor((aiScore * AI_WEIGHT_BPS + bureauScore * BUREAU_WEIGHT_BPS) / BPS_DENOMINATOR);
}

/**
 * Parse the model's text output into a `ConfidentialAiResult`. Tolerates code
 * fences and surrounding prose; falls back to a strength-derived result so the
 * demo never hard-fails on a malformed generation.
 */
export function parseAiOutput(output: string | undefined, fallbackStrength: BorrowerStrength): ConfidentialAiResult {
  const parsed = tryExtractJson(output);
  if (parsed) {
    const score = clampScore(Number(parsed.creditworthiness_score ?? 0));
    return {
      business_verified: Boolean(parsed.business_verified),
      document_authenticity: asBand(parsed.document_authenticity),
      fraud_risk: asBand(parsed.fraud_risk),
      cashflow_strength: asBand(parsed.cashflow_strength),
      debt_capacity: asBand(parsed.debt_capacity),
      creditworthiness_score: score,
      // Keep tier consistent with the numeric score regardless of what the model said.
      risk_tier: tierFromScore(score),
      reasoning_summary: String(parsed.reasoning_summary ?? "").slice(0, 1000),
      missing_information: Array.isArray(parsed.missing_information)
        ? parsed.missing_information.map(String).slice(0, 12)
        : [],
    };
  }
  return fallbackAiResult(fallbackStrength);
}

/** Deterministic AI result used for the mock fallback (no API key) or parse failure. */
export function fallbackAiResult(strength: BorrowerStrength): ConfidentialAiResult {
  const byStrength: Record<BorrowerStrength, ConfidentialAiResult> = {
    strong: {
      business_verified: true,
      document_authenticity: "high",
      fraud_risk: "low",
      cashflow_strength: "high",
      debt_capacity: "high",
      creditworthiness_score: 815,
      risk_tier: "low_default_risk",
      reasoning_summary: "Strong, consistent cash flow and clean filings support a low default risk.",
      missing_information: [],
    },
    medium: {
      business_verified: true,
      document_authenticity: "medium",
      fraud_risk: "low",
      cashflow_strength: "medium",
      debt_capacity: "medium",
      creditworthiness_score: 690,
      risk_tier: "medium_default_risk",
      reasoning_summary: "Adequate but uneven cash flow; manual review recommended before full approval.",
      missing_information: ["recent bank statements"],
    },
    weak: {
      business_verified: false,
      document_authenticity: "low",
      fraud_risk: "medium",
      cashflow_strength: "low",
      debt_capacity: "low",
      creditworthiness_score: 520,
      risk_tier: "high_default_risk",
      reasoning_summary: "Thin and inconsistent evidence with adverse signals; high default risk.",
      missing_information: ["tax returns", "A/R aging report", "verified bank statements"],
    },
  };
  return byStrength[strength];
}

type ScoreResultArgs = {
  inferenceId: string;
  model: string;
  attested: boolean;
  ai: ConfidentialAiResult;
  bureau: CreditBureauSignal;
  snapshot?: InferenceSnapshot;
  documentsBase64: string[];
  nowSeconds: number;
};

/** Assemble the full ScoreResult, including the onchain-ready `ScoreInputs`. */
export function buildScoreResult({
  inferenceId,
  model,
  attested,
  ai,
  bureau,
  snapshot,
  documentsBase64,
  nowSeconds,
}: ScoreResultArgs): ScoreResult {
  const aiScore = clampScore(ai.creditworthiness_score);
  const bureauScore = clampScore(bureau.bureauScore);
  const combinedScore = combineScore(aiScore, bureauScore);
  const riskTier = tierFromScore(combinedScore);

  const attestationHash = keccak256(stringToBytes(JSON.stringify({ inferenceId, model, output: ai })));
  const evidenceDigest = computeEvidenceDigest(snapshot, documentsBase64);

  const scoreInputs: ScoreInputs = {
    confidentialAiScore: aiScore,
    bureauScore,
    attestationHash,
    bureauReportHash: bureau.rawReportHash,
    evidenceDigest,
    expiresAt: nowSeconds + CERTIFICATE_VALIDITY_SECONDS,
  };

  return {
    inferenceId,
    model,
    attested,
    confidentialAi: ai,
    bureau,
    combinedScore,
    riskTier,
    eligible: combinedScore >= MIN_ELIGIBLE_SCORE && riskTier !== "high_default_risk",
    minEligibleScore: MIN_ELIGIBLE_SCORE,
    weights: { aiBps: AI_WEIGHT_BPS, bureauBps: BUREAU_WEIGHT_BPS },
    scoreInputs,
    usage: snapshot?.usage,
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
