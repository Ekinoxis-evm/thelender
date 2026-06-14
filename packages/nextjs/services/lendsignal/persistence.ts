/**
 * Persist each credit check to Supabase — SERVER ONLY, best-effort.
 *
 * Stores only the normalized result, content hashes and the Chainlink request id
 * (privacy boundary: no raw documents). Failures never break the scoring request.
 */
import type { BusinessProfile, ScoreResult } from "./types";
import { createAdminClient } from "~~/services/supabase/admin";

const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function persistCreditCheck(args: {
  result: ScoreResult;
  profile: BusinessProfile;
  borrower?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const { result, profile, borrower } = args;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("credit_checks").insert({
      borrower: borrower ?? null,
      inference_id: result.inferenceId,
      model: result.model,
      attested: result.attested,
      combined_score: result.combinedScore,
      ai_score: result.scoreInputs.confidentialAiScore,
      bureau_score: result.scoreInputs.bureauScore,
      risk_tier: result.riskTier,
      eligible: result.eligible,
      attestation_hash: result.scoreInputs.attestationHash,
      bureau_report_hash: result.scoreInputs.bureauReportHash,
      evidence_digest: result.scoreInputs.evidenceDigest,
      offchain_inference_id: result.offchain?.inferenceId ?? null,
      offchain_profile_score: result.offchain?.profileScore ?? null,
      legal_name: profile.legalName,
      country: profile.country,
      industry: profile.industry ?? null,
      requested_loan_usd: profile.requestedLoanUsd ?? null,
    });
    if (error) console.warn("[credit_checks] insert failed:", error.message);
  } catch (e) {
    console.warn("[credit_checks] persistence error:", e instanceof Error ? e.message : e);
  }
}
