import { NextRequest, NextResponse } from "next/server";
import {
  type InferenceSnapshot,
  isConfidentialAiConfigured,
  runInference,
} from "~~/services/lendsignal/confidentialAi";
import { type BorrowerStrength, evaluateBureau } from "~~/services/lendsignal/creditBureau";
import { getDemoProfile } from "~~/services/lendsignal/demoProfiles";
import { buildScoreResult, fallbackAiResult, parseAiOutput } from "~~/services/lendsignal/score";
import type { BusinessProfile, ConfidentialAiResult, UploadedDocument } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/score
 *
 * The LendSignal scoring pipeline (server-side; the Confidential AI API key never
 * reaches the client):
 *   1. Chainlink Confidential AI Attester — attested inference over the documents
 *   2. CRS bureau (mock)                  — normalized credit signal
 *   3. combine 70/30                      — combinedScore + riskTier + onchain ScoreInputs
 *
 * Falls back to a deterministic mock (attested:false) when no API key is set, so
 * the flow is fully usable in local dev without credentials.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = process.env.CHAINLINK_CONFIDENTIAL_AI_MODEL ?? "gemma4";

type RequestBody = {
  profile: BusinessProfile;
  documents?: UploadedDocument[];
  demoProfileId?: string;
  strength?: BorrowerStrength;
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

  // --- Step 1: Confidential AI inference (or mock fallback) ---
  let ai: ConfidentialAiResult;
  let attested = false;
  let inferenceId: string;
  let snapshot: InferenceSnapshot | undefined;
  let note: string | undefined;

  if (isConfidentialAiConfigured()) {
    try {
      snapshot = await runInference({ profile, documents });
      if (snapshot.status === "completed") {
        ai = parseAiOutput(snapshot.output, strength);
        attested = true;
        inferenceId = snapshot.id;
      } else {
        ai = fallbackAiResult(strength);
        inferenceId = snapshot.id;
        note = `Inference returned status "${snapshot.status}"${snapshot.error ? `: ${snapshot.error}` : ""}. Using fallback scoring.`;
      }
    } catch (e) {
      ai = fallbackAiResult(strength);
      inferenceId = `mock-${nowSeconds}`;
      note = `Confidential AI request failed (${e instanceof Error ? e.message : String(e)}). Using fallback scoring.`;
    }
  } else {
    ai = fallbackAiResult(strength);
    inferenceId = `mock-${nowSeconds}`;
    note = "CHAINLINK_CONFIDENTIAL_AI_API_KEY not set — returning a deterministic mock (not attested).";
  }

  // --- Step 2: CRS bureau (mock) ---
  const bureau = evaluateBureau(profile, strength);

  // --- Step 3: combine 70/30 → onchain-ready ScoreInputs ---
  const result = buildScoreResult({
    inferenceId,
    model: MODEL,
    attested,
    ai,
    bureau,
    snapshot,
    documentsBase64,
    nowSeconds,
  });

  return NextResponse.json({ ...result, ...(note ? { note } : {}) });
}
