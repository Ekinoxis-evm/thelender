import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { scoreMessage } from "~~/lib/kredito";
import { getAiConfig } from "~~/services/kredito/admin";
import { verifyWalletControl } from "~~/services/kredito/verifyWallet";
import { type InferenceSnapshot, getInference, runInference } from "~~/services/lendsignal/confidentialAi";
import {
  type DocumentInferenceRow,
  persistCreditCheck,
  persistDocumentInferences,
} from "~~/services/lendsignal/persistence";
import { type SectionSummary, buildReducePrompt } from "~~/services/lendsignal/prompt";
import { buildScoreResult, parseReduceOutput, parseSectionOutput } from "~~/services/lendsignal/score";
import type { BusinessProfile, DocumentAnalysis, InferenceRef } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/score/finish  { profile, borrower, docs }
 *
 * Step 3 of the client-orchestrated pipeline. The client has already polled every
 * per-document inference to completion. This handler:
 *   1. reads each completed section snapshot (502 if any is not "completed"),
 *   2. parses it into a per-document analysis + section score,
 *   3. runs the ONE reduce inference (capped well under 300s),
 *   4. assembles the StoredScore, persists the check + per-document rows,
 *   5. returns the StoredScore (the same shape the client already consumes).
 *
 * 100% Confidential AI — no mocks. Any failure surfaces as a clear 502.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type FinishDoc = {
  filename: string;
  type: string;
  prompt: string;
  systemPrompt: string;
  inferenceId: string;
};

type RequestBody = {
  profile: BusinessProfile;
  borrower?: string;
  docs?: FinishDoc[];
  signature?: `0x${string}`;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Body must be JSON." }, { status: 400 });
  }

  const { profile, borrower } = body;
  if (!profile?.legalName || !profile?.country) {
    return NextResponse.json(
      { error: "invalid_request", message: "profile.legalName and profile.country are required." },
      { status: 400 },
    );
  }

  // AuthZ: the persisted credit_check is attributed to `borrower`; require proof the caller controls it.
  if (!borrower || !isAddress(borrower)) {
    return NextResponse.json({ error: "invalid_request", message: "Valid borrower required." }, { status: 400 });
  }
  if (!(await verifyWalletControl(borrower as `0x${string}`, scoreMessage(borrower), body.signature))) {
    return NextResponse.json(
      { error: "unauthorized", message: "Signature does not prove control of the wallet." },
      { status: 401 },
    );
  }

  const docs: FinishDoc[] = body.docs ?? [];
  if (docs.length === 0) {
    return NextResponse.json(
      { error: "no_documents", message: "No analyzed documents were provided to finalize the credit check." },
      { status: 400 },
    );
  }

  const cfg = await getAiConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    // --- Collect each completed section snapshot, parse → analysis + section score ---
    const inferences: InferenceRef[] = [];
    const docAnalyses: DocumentAnalysis[] = [];
    const summaries: SectionSummary[] = [];
    const docRows: DocumentInferenceRow[] = [];
    const resourceDigests: string[] = [];
    let scoreSum = 0;

    for (const d of docs) {
      const snap = await getInference(d.inferenceId);
      if (snap.status !== "completed") {
        return NextResponse.json(
          {
            error: "inference_incomplete",
            message: `Credit analysis failed — the analysis of ${d.filename} didn't complete. Please retry.`,
          },
          { status: 502 },
        );
      }

      const { docAnalysis, sectionScore } = parseSectionOutput(snap.output, d.type, d.filename);
      docAnalyses.push(docAnalysis);
      scoreSum += sectionScore;
      summaries.push({
        type: d.type,
        filename: d.filename,
        json: JSON.stringify({ ...docAnalysis, section_score: sectionScore }),
      });
      inferences.push({ label: d.type, inferenceId: d.inferenceId, attested: true });

      for (const r of snap.resources ?? []) {
        const digest = r.response_digest ?? r.digest ?? "";
        if (digest) resourceDigests.push(digest);
      }

      docRows.push({
        borrower,
        inferenceId: d.inferenceId,
        filename: d.filename,
        documentType: docAnalysis.documentType,
        status: snap.status,
        sectionScore,
        prompt: d.prompt,
        systemPrompt: d.systemPrompt,
        output: snap.output ?? "",
      });
    }

    const avgSectionScore = docAnalyses.length ? Math.round(scoreSum / docAnalyses.length) : 0;

    // --- REDUCE: one inference. 60 × 3s = 180s ceiling, well under maxDuration. ---
    const reduceSnap = await runInference(
      {
        prompt: buildReducePrompt(profile, summaries),
        systemPrompt: cfg.reduce_system_prompt,
        documents: [],
        model: cfg.model,
      },
      { intervalMs: 3000, maxAttempts: 60 },
    );
    if (reduceSnap.status !== "completed") {
      return NextResponse.json(
        {
          error: "reduce_incomplete",
          message: "Credit analysis failed — the final decision did not complete. Please retry.",
        },
        { status: 502 },
      );
    }

    const ai = parseReduceOutput(reduceSnap.output, docAnalyses, avgSectionScore);
    inferences.push({ label: "Decision (reduce)", inferenceId: reduceSnap.id, attested: true });

    // Carry the TEE's own per-document resource digests into the evidence digest (no raw bytes here).
    const evidenceSnapshot: InferenceSnapshot = {
      id: reduceSnap.id,
      status: reduceSnap.status,
      resources: resourceDigests.map(response_digest => ({ response_digest })),
    };

    const result = buildScoreResult({
      inferenceId: reduceSnap.id,
      model: cfg.model,
      attested: true,
      ai,
      snapshot: { ...evidenceSnapshot, usage: reduceSnap.usage },
      documentsBase64: [],
      nowSeconds,
      inferences,
    });

    // Persist the normalized check + per-document rows (best-effort; never blocks the response).
    await persistCreditCheck({ result, profile, borrower });
    await persistDocumentInferences(docRows);

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Credit analysis failed — please retry.";
    return NextResponse.json({ error: "scoring_failed", message }, { status: 502 });
  }
}
