import "server-only";
import {
  CREDIT_SYSTEM_PROMPT,
  PROFILE_SYSTEM_PROMPT,
  REDUCE_SYSTEM_PROMPT,
  SECTION_SYSTEM_PROMPT,
} from "~~/services/lendsignal/prompt";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * Server-only admin data: a live status view + the admin-managed AI config (model + system prompts).
 * The AI config is stored in Supabase so it can be reviewed/updated without a redeploy; the score
 * pipeline reads the active row via getAiConfig() (fast-follow), falling back to these code defaults.
 */

export type AiConfig = {
  model: string;
  credit_system_prompt: string;
  section_system_prompt: string;
  reduce_system_prompt: string;
  profile_system_prompt: string;
  notes?: string | null;
  updated_at?: string;
};

const defaults = (): AiConfig => ({
  model: process.env.CHAINLINK_CONFIDENTIAL_AI_MODEL ?? "gemma4",
  credit_system_prompt: CREDIT_SYSTEM_PROMPT,
  section_system_prompt: SECTION_SYSTEM_PROMPT,
  reduce_system_prompt: REDUCE_SYSTEM_PROMPT,
  profile_system_prompt: PROFILE_SYSTEM_PROMPT,
});

/** The active AI config — Supabase row if present, else the in-code defaults. */
export async function getAiConfig(): Promise<AiConfig & { source: "supabase" | "defaults" }> {
  const db = createAdminClient();
  const { data } = await db
    .from("ai_config")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const d = defaults();
  if (!data) return { ...d, source: "defaults" };
  return {
    model: data.model ?? d.model,
    credit_system_prompt: data.credit_system_prompt ?? d.credit_system_prompt,
    section_system_prompt: data.section_system_prompt ?? d.section_system_prompt,
    reduce_system_prompt: data.reduce_system_prompt ?? d.reduce_system_prompt,
    profile_system_prompt: data.profile_system_prompt ?? d.profile_system_prompt,
    notes: data.notes,
    updated_at: data.updated_at,
    source: "supabase",
  };
}

/** Save a new active AI config (deactivates the previous one, keeping history for review). */
export async function saveAiConfig(cfg: Partial<AiConfig>): Promise<void> {
  const db = createAdminClient();
  await db.from("ai_config").update({ active: false }).eq("active", true);
  const { error } = await db.from("ai_config").insert({ ...defaults(), ...cfg, active: true });
  if (error) throw new Error(error.message);
}

/** Live status: recent credit checks + issued identities. */
export async function getAdminOverview() {
  const db = createAdminClient();
  const [checks, identities] = await Promise.all([
    db
      .from("credit_checks")
      .select("borrower, eligible, risk_tier, combined_score, attested, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("ens_identities")
      .select("label, full_name, wallet_address, status, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);
  return { checks: checks.data ?? [], identities: identities.data ?? [] };
}
