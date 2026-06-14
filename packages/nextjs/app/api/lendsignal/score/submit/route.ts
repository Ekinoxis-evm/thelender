import { NextRequest, NextResponse } from "next/server";
import { getAiConfig } from "~~/services/kredito/admin";
import { isConfidentialAiConfigured, submitInference } from "~~/services/lendsignal/confidentialAi";
import { SECTION_FOCUS, buildSectionPrompt, detectSection } from "~~/services/lendsignal/prompt";
import type { BusinessProfile, UploadedDocument } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/score/submit  { profile, documents }
 *
 * Step 1 of the client-orchestrated map→reduce pipeline. For each document it
 * detects the section, builds the section prompt and SUBMITS one Confidential AI
 * inference (returns the request id immediately — NO polling). This handler is fast
 * (just N submits), so it never approaches the Vercel serverless timeout.
 *
 * The client then polls each inferenceId via GET /api/lendsignal/inference/:id and,
 * once all complete, calls POST /api/lendsignal/score/finish to reduce + persist.
 *
 * The prompt + systemPrompt are returned so /finish can re-parse and log them; they
 * contain no secrets (the API key never leaves the server).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  profile: BusinessProfile;
  documents?: UploadedDocument[];
};

export type SubmittedDoc = {
  filename: string;
  section: string;
  type: string;
  prompt: string;
  systemPrompt: string;
  inferenceId: string;
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

  // Admin-managed model + system prompts (Supabase ai_config; falls back to code defaults).
  const cfg = await getAiConfig();

  try {
    const docs: SubmittedDoc[] = await Promise.all(
      documents.map(async doc => {
        const section = detectSection(doc.filename);
        const { type } = SECTION_FOCUS[section];
        const prompt = buildSectionPrompt(section, profile, doc.filename);
        const systemPrompt = cfg.section_system_prompt;
        const inferenceId = await submitInference({
          prompt,
          systemPrompt,
          documents: [doc],
          model: cfg.model,
        });
        return { filename: doc.filename, section, type, prompt, systemPrompt, inferenceId };
      }),
    );

    return NextResponse.json({ docs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to submit credit analysis — please retry.";
    return NextResponse.json({ error: "submit_failed", message }, { status: 502 });
  }
}
