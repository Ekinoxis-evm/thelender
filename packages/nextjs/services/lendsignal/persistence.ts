/**
 * Persist each credit check to Supabase — SERVER ONLY, best-effort.
 *
 * Stores only the normalized result, content hashes and the Chainlink request id
 * (privacy boundary: no raw documents). Failures never break the scoring request.
 */
import type { BusinessProfile, ScoreResult } from "./types";
import "server-only";
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
      risk_tier: result.riskTier,
      eligible: result.eligible,
      attestation_hash: result.scoreInputs.attestationHash,
      evidence_digest: result.scoreInputs.evidenceDigest,
      legal_name: profile.legalName,
      country: profile.country,
      enterprise_type: profile.enterpriseType ?? null,
      tax_number: profile.taxNumber ?? null,
      registry_number: profile.registryNumber ?? null,
    });
    if (error) console.warn("[credit_checks] insert failed:", error.message);
  } catch (e) {
    console.warn("[credit_checks] persistence error:", e instanceof Error ? e.message : e);
  }
}

/** One per-document inference row (no raw document bytes — only the prompt/output/summary). */
export type DocumentInferenceRow = {
  borrower?: string;
  inferenceId: string;
  filename: string;
  documentType: string;
  status: string;
  sectionScore: number;
  prompt: string;
  systemPrompt: string;
  output: string;
};

/**
 * Persist the per-document inference log to Supabase — SERVER ONLY, best-effort.
 * Never throws/blocks the scoring response; failures only warn.
 */
export async function persistDocumentInferences(rows: DocumentInferenceRow[]): Promise<void> {
  if (!isSupabaseConfigured() || rows.length === 0) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("document_inferences").insert(
      rows.map(r => ({
        borrower: r.borrower ?? null,
        inference_id: r.inferenceId,
        filename: r.filename,
        document_type: r.documentType,
        status: r.status,
        section_score: r.sectionScore,
        prompt: r.prompt,
        system_prompt: r.systemPrompt,
        output: r.output,
      })),
    );
    if (error) console.warn("[document_inferences] insert failed:", error.message);
  } catch (e) {
    console.warn("[document_inferences] persistence error:", e instanceof Error ? e.message : e);
  }
}
