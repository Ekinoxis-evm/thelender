/**
 * CRS Credit Bureau Adapter (Feature 3) — mock implementation.
 *
 * Same response shape the real CRS integration will use later (see plan). For the
 * hackathon the signal is deterministic, keyed by a borrower-strength hint:
 *   strong -> 782 / low risk   ·   medium -> 668 / medium   ·   weak -> 540 / high
 *
 * Privacy rule: only the normalized signal + a report hash are surfaced; no raw
 * CRS report ever goes onchain.
 */
import type { BusinessProfile, CreditBureauSignal, RiskBand } from "./types";
import { keccak256, stringToBytes } from "viem";

export type BorrowerStrength = "strong" | "medium" | "weak";

type BureauBaseline = {
  bureauScore: number;
  paymentRisk: RiskBand;
  fraudRisk: RiskBand;
  publicRecordsRisk: RiskBand;
  recommendedCreditLimitUsd: number;
  delinquencyRisk12mo: number;
  adverseSignals: string[];
  positiveSignals: string[];
};

const BASELINES: Record<BorrowerStrength, BureauBaseline> = {
  strong: {
    bureauScore: 782,
    paymentRisk: "low",
    fraudRisk: "low",
    publicRecordsRisk: "low",
    recommendedCreditLimitUsd: 30000,
    delinquencyRisk12mo: 0.08,
    adverseSignals: [],
    positiveSignals: [
      "business identity matched",
      "no bankruptcy records found",
      "low days-beyond-terms indicator",
      "positive trade payment history",
    ],
  },
  medium: {
    bureauScore: 668,
    paymentRisk: "medium",
    fraudRisk: "low",
    publicRecordsRisk: "medium",
    recommendedCreditLimitUsd: 15000,
    delinquencyRisk12mo: 0.19,
    adverseSignals: ["occasional days-beyond-terms over the last 12 months", "one open UCC filing"],
    positiveSignals: ["business identity matched", "no bankruptcy records found"],
  },
  weak: {
    bureauScore: 540,
    paymentRisk: "high",
    fraudRisk: "medium",
    publicRecordsRisk: "high",
    recommendedCreditLimitUsd: 5000,
    delinquencyRisk12mo: 0.41,
    adverseSignals: [
      "multiple late payments reported",
      "active lien on record",
      "thin trade history",
      "identity match confidence reduced",
    ],
    positiveSignals: ["business is currently operating"],
  },
};

/**
 * Evaluate a business against the (mock) bureau. `strength` is the demo hint; for
 * a custom upload with no hint we default to `medium`, since a real CRS pull would
 * be needed to do better.
 */
export function evaluateBureau(profile: BusinessProfile, strength: BorrowerStrength = "medium"): CreditBureauSignal {
  const base = BASELINES[strength];
  const reportId = `crs_mock_${strength}_${profile.taxIdLast4 ?? "0000"}`;

  // Hash a canonical view of the "raw report" so we can stage `bureauReportHash`
  // onchain without ever publishing the report itself.
  const rawReportHash = keccak256(
    stringToBytes(
      JSON.stringify({
        reportId,
        legalName: profile.legalName,
        country: profile.country,
        ...base,
      }),
    ),
  );

  return {
    provider: "crs_mock",
    reportId,
    businessVerified: strength !== "weak",
    principalMatched: strength === "strong",
    bureauScore: base.bureauScore,
    paymentRisk: base.paymentRisk,
    fraudRisk: base.fraudRisk,
    publicRecordsRisk: base.publicRecordsRisk,
    recommendedCreditLimitUsd: base.recommendedCreditLimitUsd,
    delinquencyRisk12mo: base.delinquencyRisk12mo,
    adverseSignals: base.adverseSignals,
    positiveSignals: base.positiveSignals,
    rawReportHash,
    pulledAt: new Date().toISOString(),
  };
}
