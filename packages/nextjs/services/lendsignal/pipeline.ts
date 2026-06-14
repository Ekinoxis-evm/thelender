/**
 * Credit pipeline — SERVER ONLY. Map → reduce over the borrower's documents:
 *   MAP    : one Confidential AI inference PER document, each with a section-specific
 *            prompt (financials / tax / bank / A/R / debt / legal), run in parallel.
 *   REDUCE : a final inference that weighs the per-section analyses into the overall
 *            credit decision.
 * Every query keeps its own attested request id (surfaced to the UI).
 *
 * NO synthetic fallbacks: if a section or the reduce inference fails or returns
 * unparseable output, this THROWS a clear Error and the route surfaces it.
 */
import { runInference } from "./confidentialAi";
import { SECTION_FOCUS, type SectionSummary, buildReducePrompt, buildSectionPrompt, detectSection } from "./prompt";
import { parseReduceOutput, parseSectionOutput } from "./score";
import type { BusinessProfile, ConfidentialAiResult, DocumentAnalysis, InferenceRef, UploadedDocument } from "./types";

export type CreditPipelineResult = {
  ai: ConfidentialAiResult;
  attested: boolean;
  inferences: InferenceRef[];
  reduceInferenceId: string;
};

/** Admin-managed AI config the pipeline runs with (model + the section/reduce system prompts). */
export type PipelineAi = { model: string; sectionSystemPrompt: string; reduceSystemPrompt: string };

export async function runCreditPipeline(
  profile: BusinessProfile,
  documents: UploadedDocument[],
  aiCfg: PipelineAi,
): Promise<CreditPipelineResult> {
  if (documents.length === 0) {
    throw new Error("No documents to analyze — upload your business documents to run a credit check.");
  }

  // --- MAP: one inference per document, in parallel ---
  const sectionResults = await Promise.all(
    documents.map(async doc => {
      const section = detectSection(doc.filename);
      const { type } = SECTION_FOCUS[section];
      // PDFs go through Docling preprocessing in the TEE — give them headroom.
      const snap = await runInference(
        {
          prompt: buildSectionPrompt(section, profile, doc.filename),
          systemPrompt: aiCfg.sectionSystemPrompt,
          documents: [doc],
          model: aiCfg.model,
        },
        { maxAttempts: 90 },
      );
      return { snap, type, filename: doc.filename };
    }),
  );

  const inferences: InferenceRef[] = [];
  const docAnalyses: DocumentAnalysis[] = [];
  const summaries: SectionSummary[] = [];
  let scoreSum = 0;

  for (const r of sectionResults) {
    if (r.snap.status !== "completed") {
      throw new Error(`Credit analysis failed — the analysis of ${r.filename} did not complete. Please retry.`);
    }
    const { docAnalysis, sectionScore } = parseSectionOutput(r.snap.output, r.type, r.filename);
    docAnalyses.push(docAnalysis);
    scoreSum += sectionScore;
    summaries.push({
      type: r.type,
      filename: r.filename,
      json: JSON.stringify({ ...docAnalysis, section_score: sectionScore }),
    });
    inferences.push({ label: r.type, inferenceId: r.snap.id, attested: true });
  }

  const avgSectionScore = docAnalyses.length ? Math.round(scoreSum / docAnalyses.length) : 0;

  // --- REDUCE: final decision over the per-section analyses ---
  const reduceSnap = await runInference({
    prompt: buildReducePrompt(profile, summaries),
    systemPrompt: aiCfg.reduceSystemPrompt,
    documents: [],
    model: aiCfg.model,
  });
  if (reduceSnap.status !== "completed") {
    throw new Error("Credit analysis failed — the final decision did not complete. Please retry.");
  }

  const ai = parseReduceOutput(reduceSnap.output, docAnalyses, avgSectionScore);
  inferences.push({ label: "Decision (reduce)", inferenceId: reduceSnap.id, attested: true });

  return {
    ai,
    attested: true,
    inferences,
    reduceInferenceId: reduceSnap.id,
  };
}
