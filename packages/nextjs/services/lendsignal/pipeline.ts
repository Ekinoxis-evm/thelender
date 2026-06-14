/**
 * Credit pipeline — SERVER ONLY. Map → reduce over the borrower's documents:
 *   MAP    : one Confidential AI inference PER document, each with a section-specific
 *            prompt (financials / tax / bank / A/R / debt / legal), run in parallel.
 *   REDUCE : a final inference that weighs the per-section analyses into the overall
 *            credit decision.
 * Every query keeps its own attested request id (surfaced to the UI).
 */
import { runInference } from "./confidentialAi";
import type { BorrowerStrength } from "./creditBureau";
import { SECTION_FOCUS, type SectionSummary, buildReducePrompt, buildSectionPrompt, detectSection } from "./prompt";
import { parseReduceOutput, parseSectionOutput, placeholderSection } from "./score";
import type { BusinessProfile, ConfidentialAiResult, DocumentAnalysis, InferenceRef, UploadedDocument } from "./types";

export type CreditPipelineResult = {
  ai: ConfidentialAiResult;
  attested: boolean;
  inferences: InferenceRef[];
  reduceInferenceId?: string;
};

/** Admin-managed AI config the pipeline runs with (model + the section/reduce system prompts). */
export type PipelineAi = { model: string; sectionSystemPrompt: string; reduceSystemPrompt: string };

export async function runCreditPipeline(
  profile: BusinessProfile,
  documents: UploadedDocument[],
  strength: BorrowerStrength,
  aiCfg: PipelineAi,
): Promise<CreditPipelineResult> {
  // --- MAP: one inference per document, in parallel ---
  const sectionResults = await Promise.all(
    documents.map(async doc => {
      const section = detectSection(doc.filename);
      const { type } = SECTION_FOCUS[section];
      try {
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
      } catch {
        return { snap: undefined, type, filename: doc.filename };
      }
    }),
  );

  const inferences: InferenceRef[] = [];
  const docAnalyses: DocumentAnalysis[] = [];
  const summaries: SectionSummary[] = [];
  let scoreSum = 0;

  for (const r of sectionResults) {
    const completed = r.snap?.status === "completed";
    const { docAnalysis, sectionScore } = completed
      ? parseSectionOutput(r.snap?.output, r.type, r.filename)
      : placeholderSection(r.type, r.filename);
    docAnalyses.push(docAnalysis);
    scoreSum += sectionScore;
    summaries.push({
      type: r.type,
      filename: r.filename,
      json: JSON.stringify({ ...docAnalysis, section_score: sectionScore }),
    });
    if (r.snap) inferences.push({ label: r.type, inferenceId: r.snap.id, attested: completed });
  }

  const avgSectionScore = docAnalyses.length ? Math.round(scoreSum / docAnalyses.length) : 0;

  // --- REDUCE: final decision over the per-section analyses ---
  let reduceSnap;
  try {
    reduceSnap = await runInference({
      prompt: buildReducePrompt(profile, summaries),
      systemPrompt: aiCfg.reduceSystemPrompt,
      documents: [],
      model: aiCfg.model,
    });
  } catch {
    reduceSnap = undefined;
  }

  const reduceCompleted = reduceSnap?.status === "completed";
  const ai = parseReduceOutput(
    reduceCompleted ? reduceSnap?.output : undefined,
    docAnalyses,
    avgSectionScore,
    strength,
  );
  if (reduceSnap)
    inferences.push({ label: "Decision (reduce)", inferenceId: reduceSnap.id, attested: Boolean(reduceCompleted) });

  const anySection = inferences.some(i => i.attested && i.label !== "Decision (reduce)");
  return {
    ai,
    attested: Boolean(reduceCompleted) && anySection,
    inferences,
    reduceInferenceId: reduceSnap?.id,
  };
}
