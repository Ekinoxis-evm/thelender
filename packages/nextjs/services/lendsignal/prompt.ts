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
  "document_analysis": [               // ONE entry per attached document
    { "filename": string, "finding": string, "signal": "positive" | "neutral" | "negative" }
  ],
  "reasoning_summary": string,
  "missing_information": string[]
}`;

export function buildCreditPrompt(profile: BusinessProfile, filenames: string[]): string {
  const fileList = filenames.length ? filenames.map(f => `- ${f}`).join("\n") : "- (none attached)";
  return [
    "You are evaluating a business borrower for an onchain working-capital loan.",
    "",
    "Business context:",
    ...businessFacts(profile).map(f => `- ${f}`),
    "",
    "Attached documents (analyze EACH one separately):",
    fileList,
    "",
    "Analyze every attached document on its own and add exactly ONE `document_analysis` entry per",
    "file, keyed by its filename, with a concise finding and whether it is positive / neutral /",
    "negative for creditworthiness. Then synthesize all documents into the overall credit fields.",
    "If the documents lack information for a field, reflect it in `missing_information` and lower the score.",
    "",
    "`creditworthiness_score` must be an integer 0..1000 consistent with `risk_tier`:",
    "  >= 750 -> low_default_risk, 600..749 -> medium_default_risk, < 600 -> high_default_risk.",
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
