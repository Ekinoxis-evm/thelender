"use client";

// Carries the real scoring result from /onboarding to /score (and /certificate)
// across the multi-page flow. sessionStorage keeps it client-only and ephemeral;
// both consumer pages are client components, so this is enough — no global store.
import type { CreditCertificate, RiskTier } from "./types";
import type { ScoreResult } from "~~/services/lendsignal/types";

export type StoredScore = ScoreResult & { note?: string };

const KEY = "kredito.scoreResult";

export const saveScoreResult = (result: StoredScore) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    /* sessionStorage unavailable (SSR / privacy mode) — non-fatal */
  }
};

export const loadScoreResult = (): StoredScore | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredScore) : null;
  } catch {
    return null;
  }
};

export const clearScoreResult = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
};

/** Map the API risk tier ("low_default_risk") to the UI tier ("low"). */
export const toUiRiskTier = (tier: ScoreResult["riskTier"]): RiskTier =>
  tier === "low_default_risk" ? "low" : tier === "medium_default_risk" ? "medium" : "high";

/**
 * Project a real ScoreResult onto the onchain-shaped CreditCertificate the UI
 * components (CertificateCard, etc.) already consume.
 */
export const toCertificate = (result: ScoreResult, borrower: `0x${string}`): CreditCertificate => ({
  borrower,
  confidentialAiScore: result.scoreInputs.confidentialAiScore,
  combinedScore: result.combinedScore,
  riskTier: toUiRiskTier(result.riskTier),
  attestationHash: result.scoreInputs.attestationHash,
  evidenceDigest: result.scoreInputs.evidenceDigest,
  ensName: undefined,
  status: result.eligible ? "active" : "pending",
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: result.scoreInputs.expiresAt,
  version: 1,
});
