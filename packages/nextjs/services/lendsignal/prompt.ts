import type { BusinessProfile } from "./types";

/**
 * Prompts for the Confidential AI queries.
 *
 *   1. CREDIT  — reads the private documents, analyzes EACH file one by one, and
 *                returns the onchain-relevant credit signal (attested).
 *   2. PROFILE — a second, OFF-CHAIN query that assesses the business/industry from
 *                the public profile only (no documents). Complementary, shown apart.
 *
 * Two layers enforce JSON (per the Confidential AI Attester skill): a system prompt
 * and an exact schema in the user prompt.
 */

const businessFacts = (profile: BusinessProfile): string[] =>
  [
    `Legal name: ${profile.legalName}`,
    profile.dbaName ? `DBA: ${profile.dbaName}` : "",
    `Country: ${profile.country}`,
    profile.state ? `State/Region: ${profile.state}` : "",
    profile.city ? `City: ${profile.city}` : "",
    profile.industry ? `Industry: ${profile.industry}` : "",
    profile.taxIdLast4 ? `Tax ID (last 4): ${profile.taxIdLast4}` : "",
    profile.ownerOrPrincipal
      ? `Principal: ${profile.ownerOrPrincipal.name} (${profile.ownerOrPrincipal.role}${
          profile.ownerOrPrincipal.ownershipPct ? `, ${profile.ownerOrPrincipal.ownershipPct}% ownership` : ""
        })`
      : "",
    profile.requestedLoanUsd ? `Requested working-capital loan: $${profile.requestedLoanUsd.toLocaleString()}` : "",
  ].filter(Boolean);

// ---------------------------------------------------------------- 1) CREDIT (documents)

export const CREDIT_SYSTEM_PROMPT =
  "You are a confidential business-credit underwriting model running inside a trusted execution environment. " +
  "You read the borrower's private documents and return ONLY a single JSON object matching the requested schema. " +
  "Do not output markdown, code fences, prose, or any text outside the JSON. " +
  "Never reproduce or expose raw private document content — reason over it and summarize only.";

const CREDIT_SCHEMA_BLOCK = `Return only JSON in exactly this shape:
{
  "business_verified": boolean,
  "document_authenticity": "low" | "medium" | "high",
  "fraud_risk": "low" | "medium" | "high",
  "cashflow_strength": "low" | "medium" | "high",
  "debt_capacity": "low" | "medium" | "high",
  "creditworthiness_score": number,   // integer 0..1000
  "risk_tier": "low_default_risk" | "medium_default_risk" | "high_default_risk",
  "decision": "approved" | "manual_review" | "denied",
  "document_analysis": [               // EXACTLY ONE entry per attached document
    {
      "filename": string,
      "document_type": string,        // e.g. "Income statement", "Tax return", "Bank statement"
      "present": boolean,             // was the document provided and readable
      "authenticity": "low" | "medium" | "high",   // does it look like a genuine document
      "consistency": "low" | "medium" | "high",     // is the data internally/cross-document consistent (truthful)
      "reliable": boolean,            // trustworthy enough to underwrite on
      "finding": string,              // concise key takeaway
      "signal": "positive" | "neutral" | "negative"
    }
  ],
  "reasoning_summary": string,
  "missing_information": string[]
}`;

export function buildCreditPrompt(profile: BusinessProfile, filenames: string[]): string {
  const fileList = filenames.length ? filenames.map(f => `- ${f}`).join("\n") : "- (none attached)";
  return [
    "You are underwriting a business borrower for an onchain working-capital loan.",
    "",
    "Business context:",
    ...businessFacts(profile).map(f => `- ${f}`),
    "",
    "Attached documents (assess EACH one separately):",
    fileList,
    "",
    "STEP 1 — Per document: add EXACTLY ONE `document_analysis` entry per attached file. For each",
    "document decide whether it is RELIABLE and TRUTHFUL: rate `authenticity` (does it look like a",
    "genuine document) and `consistency` (do the figures hold together internally and across the",
    "other documents). Set `reliable` to false if it looks fabricated, altered, or inconsistent.",
    "",
    "STEP 2 — Reduce: synthesize the per-document summaries into the overall credit fields, the",
    "`creditworthiness_score`, and a final `decision`:",
    "  approved -> strong, reliable evidence; manual_review -> mixed/incomplete; denied -> weak or unreliable.",
    "Down-weight any document that is not `reliable`. List gaps in `missing_information`.",
    "",
    "`creditworthiness_score` must be an integer 0..1000 consistent with `risk_tier` and `decision`:",
    "  >= 750 -> low_default_risk / approved, 600..749 -> medium_default_risk / manual_review,",
    "  < 600 -> high_default_risk / denied. Score strictly on the evidence: excellent financials with",
    "  clean filings should score high (800+); thin, loss-making, or adverse evidence should score low (<550).",
    "",
    CREDIT_SCHEMA_BLOCK,
    "",
    "Do not expose raw private document content.",
  ].join("\n");
}

// ---------------------------------------------------------------- 2) PROFILE (off-chain, no docs)

export const PROFILE_SYSTEM_PROMPT =
  "You are a credit-market analyst. Using ONLY the public business profile provided (no private " +
  "documents), give a high-level, off-chain creditworthiness and industry-risk read. " +
  "Return ONLY a single JSON object — no markdown, code fences, or text outside the JSON.";

const PROFILE_SCHEMA_BLOCK = `Return only JSON in exactly this shape:
{
  "profile_score": number,            // integer 0..1000 (informational, off-chain)
  "industry_risk": "low" | "medium" | "high",
  "market_view": string,              // one line on the sector/market outlook
  "summary": string                   // one or two sentences on profile-level creditworthiness
}`;

export function buildProfilePrompt(profile: BusinessProfile): string {
  return [
    "Give an OFF-CHAIN, profile-only creditworthiness read for this business.",
    "No private documents are provided — reason only from the public profile and general",
    "knowledge of the industry and market. This is a complementary signal, separate from the",
    "document-based attested score.",
    "",
    "Business profile:",
    ...businessFacts(profile).map(f => `- ${f}`),
    "",
    PROFILE_SCHEMA_BLOCK,
  ].join("\n");
}

// ---------------------------------------------------------------- 3) SECTION (one inference per document)

export type SectionKey = "financials" | "tax" | "bank" | "ar" | "debt" | "legal" | "general";

/** Each evidence section gets its own analysis lens. */
export const SECTION_FOCUS: Record<SectionKey, { type: string; focus: string }> = {
  financials: {
    type: "Financial statements",
    focus: "revenue, margins, profitability, growth trend and net-income quality",
  },
  tax: { type: "Tax returns", focus: "filing status, consistency with reported revenue, and any tax liabilities" },
  bank: {
    type: "Bank statements",
    focus: "average balances, deposits vs reported revenue, and overdraft / NSF events",
  },
  ar: {
    type: "Accounts receivable aging",
    focus: "receivable quality, aging buckets, concentration and collectibility",
  },
  debt: { type: "Debt schedule", focus: "leverage, payment history and any costly or encumbering obligations" },
  legal: { type: "Legal & formation", focus: "registration, licenses and liens / judgments / bankruptcies" },
  general: {
    type: "Supporting document",
    focus: "anything relevant to creditworthiness, authenticity and consistency",
  },
};

/** Classify a document into a section from its filename. */
export function detectSection(filename: string): SectionKey {
  const f = filename.toLowerCase();
  if (/(income|financ|p&l|profit|balance|cash.?flow)/.test(f)) return "financials";
  if (/tax/.test(f)) return "tax";
  if (/bank|statement/.test(f)) return "bank";
  if (/(a\/?r|receivable|aging)/.test(f)) return "ar";
  if (/debt|loan|liab/.test(f)) return "debt";
  if (/legal|article|license|formation|incorp|ein/.test(f)) return "legal";
  return "general";
}

export const SECTION_SYSTEM_PROMPT =
  "You are a confidential credit underwriter analyzing ONE business document inside a trusted execution " +
  "environment. Return ONLY a single JSON object — no markdown, code fences, or text outside the JSON. " +
  "Never reproduce raw private document content; reason over it and summarize only.";

const SECTION_SCHEMA_BLOCK = `Return only JSON in exactly this shape:
{
  "document_type": string,
  "present": boolean,                  // was the document provided and readable
  "authenticity": "low" | "medium" | "high",   // does it look like a genuine document
  "consistency": "low" | "medium" | "high",     // do the figures hold together (truthful)
  "reliable": boolean,                 // trustworthy enough to underwrite on
  "finding": string,                   // concise key takeaway
  "signal": "positive" | "neutral" | "negative",
  "section_score": number              // integer 0..1000 — how well THIS document supports the loan
}`;

export function buildSectionPrompt(section: SectionKey, profile: BusinessProfile, filename: string): string {
  const { type, focus } = SECTION_FOCUS[section];
  return [
    `You are analyzing ONE document — a ${type} ("${filename}") — for ${profile.legalName}` +
      (profile.industry ? ` (${profile.industry}).` : "."),
    `Focus on ${focus}.`,
    "Decide whether the document is RELIABLE and TRUTHFUL: rate `authenticity` (a genuine document) and",
    "`consistency` (the figures are internally coherent). Set `reliable` to false if it looks fabricated,",
    "altered, incomplete, or inconsistent. Then score THIS section 0..1000 for how well it supports a",
    "working-capital loan (excellent evidence 800+, adverse or missing evidence <500).",
    "",
    SECTION_SCHEMA_BLOCK,
    "",
    "Do not expose raw private document content.",
  ].join("\n");
}

// ---------------------------------------------------------------- 4) REDUCE (final decision over all sections)

export const REDUCE_SYSTEM_PROMPT =
  "You are the lead underwriter. You receive per-section analyses of a borrower's documents (already " +
  "summarized) and produce the overall credit decision as ONLY a single JSON object. No markdown or extra text.";

const REDUCE_SCHEMA_BLOCK = `Return only JSON in exactly this shape:
{
  "business_verified": boolean,
  "document_authenticity": "low" | "medium" | "high",
  "fraud_risk": "low" | "medium" | "high",
  "cashflow_strength": "low" | "medium" | "high",
  "debt_capacity": "low" | "medium" | "high",
  "creditworthiness_score": number,   // integer 0..1000
  "risk_tier": "low_default_risk" | "medium_default_risk" | "high_default_risk",
  "decision": "approved" | "manual_review" | "denied",
  "reasoning_summary": string,
  "missing_information": string[]
}`;

export type SectionSummary = { type: string; filename: string; json: string };

export function buildReducePrompt(profile: BusinessProfile, sections: SectionSummary[]): string {
  return [
    `You are the lead underwriter for ${profile.legalName}. Below are the per-section analyses of the`,
    "borrower's documents. Internally weigh each section, DOWN-WEIGHT any that is not reliable, and",
    "synthesize the overall creditworthiness, score, and final decision.",
    "",
    "Per-section analyses:",
    ...sections.map(s => `- ${s.type} (${s.filename}): ${s.json}`),
    "",
    "`creditworthiness_score` (0..1000) must be consistent with `risk_tier` and `decision`:",
    "  >= 750 -> low_default_risk / approved, 600..749 -> medium_default_risk / manual_review,",
    "  < 600 -> high_default_risk / denied.",
    "",
    REDUCE_SCHEMA_BLOCK,
  ].join("\n");
}
