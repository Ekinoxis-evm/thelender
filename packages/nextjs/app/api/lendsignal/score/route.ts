import { NextRequest, NextResponse } from "next/server";
import { getAiConfig } from "~~/services/kredito/admin";
import { isConfidentialAiConfigured } from "~~/services/lendsignal/confidentialAi";
import { persistCreditCheck } from "~~/services/lendsignal/persistence";
import { runCreditPipeline } from "~~/services/lendsignal/pipeline";
import { buildScoreResult } from "~~/services/lendsignal/score";
import type { BusinessProfile, UploadedDocument } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/score
 *
 * Map → reduce credit pipeline (server-side; the API key never reaches the client):
 *   1. one Confidential AI inference PER uploaded document (section-specific prompts), in parallel
 *   2. a reduce inference → overall decision
 *   3. assemble onchain-ready ScoreInputs from the AI score
 *
 * The score is 100% the Confidential AI score. There is NO mock/demo/synthetic
 * fallback: if the API key is missing or any inference fails, this returns a clear
 * 4xx/5xx error so the UI shows a real error rather than a fake score.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  profile: BusinessProfile;
  documents?: UploadedDocument[];
  /** Connected wallet (credit identity) — stored with the check. */
  borrower?: string;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Body must be JSON." }, { status: 400 });
  }

  const { profile } = body;
  if (!profile?.legalName || !profile?.country) {
    return NextResponse.json(
      { error: "invalid_request", message: "profile.legalName and profile.country are required." },
      { status: 400 },
    );
  }

  const documents: UploadedDocument[] = body.documents ?? [];
  if (documents.length === 0) {
    return NextResponse.json(
      { error: "no_documents", message: "Upload your business documents to run a credit check." },
      { status: 400 },
    );
  }
  if (documents.length > 10) {
    return NextResponse.json(
      { error: "invalid_request", message: "At most 10 documents are allowed." },
      { status: 400 },
    );
  }

  if (!isConfidentialAiConfigured()) {
    return NextResponse.json(
      {
        error: "ai_not_configured",
        message: "Confidential AI is not configured — set CHAINLINK_CONFIDENTIAL_AI_API_KEY to run credit analysis.",
      },
      { status: 503 },
    );
  }

  const documentsBase64 = documents.map(d => d.contentBase64);
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Admin-managed model + system prompts (Supabase ai_config; falls back to code defaults).
  const cfg = await getAiConfig();

  try {
    // --- Map → reduce pipeline (per-section + reduce). Throws on any failure. ---
    const pipe = await runCreditPipeline(profile, documents, {
      model: cfg.model,
      sectionSystemPrompt: cfg.section_system_prompt,
      reduceSystemPrompt: cfg.reduce_system_prompt,
    });

    // Assemble onchain-ready ScoreInputs (score == Confidential AI score).
    const result = buildScoreResult({
      inferenceId: pipe.reduceInferenceId,
      model: cfg.model,
      attested: pipe.attested,
      ai: pipe.ai,
      documentsBase64,
      nowSeconds,
      inferences: pipe.inferences,
    });

    // Persist the normalized check (best-effort; never blocks the response on failure).
    await persistCreditCheck({ result, profile, borrower: body.borrower });

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Credit analysis failed — please retry.";
    return NextResponse.json({ error: "scoring_failed", message }, { status: 502 });
  }
}
