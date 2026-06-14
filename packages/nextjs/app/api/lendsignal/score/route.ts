import { NextRequest, NextResponse } from "next/server";
import { isConfidentialAiConfigured, runInference } from "~~/services/lendsignal/confidentialAi";
import { type BorrowerStrength, evaluateBureau } from "~~/services/lendsignal/creditBureau";
import { getDemoProfile } from "~~/services/lendsignal/demoProfiles";
import { persistCreditCheck } from "~~/services/lendsignal/persistence";
import { runCreditPipeline } from "~~/services/lendsignal/pipeline";
import { PROFILE_SYSTEM_PROMPT, buildProfilePrompt } from "~~/services/lendsignal/prompt";
import {
  applyDemoBand,
  buildScoreResult,
  fallbackAiResult,
  fallbackOffchain,
  parseProfileOutput,
} from "~~/services/lendsignal/score";
import type {
  BusinessProfile,
  ConfidentialAiResult,
  InferenceRef,
  OffchainProfileSignal,
  UploadedDocument,
} from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/score
 *
 * Map → reduce credit pipeline (server-side; the API key never reaches the client):
 *   1. one Confidential AI inference PER document (section-specific prompts), in parallel
 *   2. a reduce inference → overall decision
 *   3. an off-chain profile inference (parallel) — complementary signal
 *   4. CRS bureau (mock) + combine 70/30 → onchain ScoreInputs
 *
 * Falls back to a deterministic mock (attested:false) when no API key is set.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = process.env.CHAINLINK_CONFIDENTIAL_AI_MODEL ?? "gemma4";

type RequestBody = {
  profile: BusinessProfile;
  documents?: UploadedDocument[];
  demoProfileId?: string;
  strength?: BorrowerStrength;
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

  // Resolve documents + the borrower-strength hint (drives the mock bureau and any fallback).
  let documents: UploadedDocument[] = [];
  let strength: BorrowerStrength = body.strength ?? "medium";

  const demo = body.demoProfileId ? getDemoProfile(body.demoProfileId) : undefined;
  if (demo) {
    strength = demo.strength;
    documents = demo.documents.map(doc => ({
      filename: doc.filename,
      contentType: "text/plain",
      contentBase64: Buffer.from(doc.content, "utf-8").toString("base64"),
    }));
  } else if (body.documents?.length) {
    documents = body.documents;
  }

  if (documents.length > 10) {
    return NextResponse.json(
      { error: "invalid_request", message: "At most 10 documents are allowed." },
      { status: 400 },
    );
  }

  const documentsBase64 = documents.map(d => d.contentBase64);
  const nowSeconds = Math.floor(Date.now() / 1000);

  // --- Step 1: the pipeline (per-section + reduce) + the off-chain query ---
  let ai: ConfidentialAiResult;
  let attested = false;
  let inferenceId: string;
  let offchain: OffchainProfileSignal | undefined;
  let inferences: InferenceRef[] = [];
  let note: string | undefined;

  if (isConfidentialAiConfigured()) {
    // Off-chain profile query runs in parallel with the whole map→reduce pipeline.
    const profilePromise = runInference({
      prompt: buildProfilePrompt(profile),
      systemPrompt: PROFILE_SYSTEM_PROMPT,
      documents: [],
    }).catch(() => undefined);

    const [pipe, profileSnap] = await Promise.all([runCreditPipeline(profile, documents, strength), profilePromise]);

    ai = pipe.ai;
    attested = pipe.attested;
    inferenceId = pipe.reduceInferenceId ?? `mock-${nowSeconds}`;
    inferences = pipe.inferences;

    offchain =
      profileSnap && profileSnap.status === "completed"
        ? parseProfileOutput(profileSnap, MODEL, strength)
        : fallbackOffchain(strength);
    inferences.push({ label: "Off-chain profile", inferenceId: offchain.inferenceId, attested: offchain.attested });

    if (!attested) {
      note = "Some Confidential AI queries did not finish in time — partial / fallback scoring was used.";
    }
  } else {
    ai = fallbackAiResult(strength);
    inferenceId = `mock-${nowSeconds}`;
    offchain = fallbackOffchain(strength);
    note = "CHAINLINK_CONFIDENTIAL_AI_API_KEY not set — returning a deterministic mock (not attested).";
  }

  // Demo profiles land on a clearly marked band regardless of live-model variance.
  if (demo) ai = applyDemoBand(ai, strength);

  // --- Step 2: CRS bureau (mock) ---
  const bureau = evaluateBureau(profile, strength);

  // --- Step 3: combine 70/30 → onchain-ready ScoreInputs (+ off-chain signal + query ids) ---
  const result = buildScoreResult({
    inferenceId,
    model: MODEL,
    attested,
    ai,
    bureau,
    documentsBase64,
    nowSeconds,
    offchain,
    inferences,
  });

  // Persist the normalized check (best-effort; never blocks the response on failure).
  await persistCreditCheck({ result, profile, borrower: body.borrower });

  return NextResponse.json({ ...result, ...(note ? { note } : {}) });
}
