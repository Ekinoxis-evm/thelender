import type { BusinessProfile } from "./types";

/**
 * Prompts for the Confidential AI credit evaluation.
 *
 * Two layers enforce JSON (per the Confidential AI Attester skill):
 *   1. system prompt — role + "return only JSON", privacy rule
 *   2. user prompt   — the business context + the exact schema to return
 */

export const CREDIT_SYSTEM_PROMPT =
  "You are a confidential business-credit underwriting model running inside a trusted execution environment. " +
  "You read the borrower's private documents and return ONLY a single JSON object matching the requested schema. " +
  "Do not output markdown, code fences, prose, or any text outside the JSON. " +
  "Never reproduce or expose raw private document content — reason over it and summarize only.";

/** The exact schema (kept in sync with `ConfidentialAiResult`). */
const SCHEMA_BLOCK = `Return only JSON in exactly this shape:
{
  "business_verified": boolean,
  "document_authenticity": "low" | "medium" | "high",
  "fraud_risk": "low" | "medium" | "high",
  "cashflow_strength": "low" | "medium" | "high",
  "debt_capacity": "low" | "medium" | "high",
  "creditworthiness_score": number,   // integer 0..1000
  "risk_tier": "low_default_risk" | "medium_default_risk" | "high_default_risk",
  "reasoning_summary": string,
  "missing_information": string[]
}`;

export function buildCreditPrompt(profile: BusinessProfile): string {
  const facts: string[] = [
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

  return [
    "You are evaluating a business borrower for an onchain working-capital loan.",
    "",
    "Business context:",
    ...facts.map(f => `- ${f}`),
    "",
    "The attached documents (if any) are the borrower's financial and legal evidence.",
    "Base your assessment on their content. If the documents do not contain enough",
    "information to answer a field, reflect that in `missing_information` and lower the score accordingly.",
    "",
    "`creditworthiness_score` must be an integer 0..1000 and must be consistent with `risk_tier`:",
    "  >= 750 -> low_default_risk, 600..749 -> medium_default_risk, < 600 -> high_default_risk.",
    "",
    SCHEMA_BLOCK,
    "",
    "Do not expose raw private document content.",
  ].join("\n");
}
