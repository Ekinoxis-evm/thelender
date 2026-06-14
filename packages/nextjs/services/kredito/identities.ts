import "server-only";
import type { CreditStatus, EnsIdentity, Profile } from "~~/lib/kredito";
import { MIN_ELIGIBLE_SCORE } from "~~/services/lendsignal/score";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * Server-only data access for KreditoOne. Uses the service-role client (bypasses RLS) because the
 * app authenticates with Privy, not Supabase Auth. The private credit SCORE lives in
 * `credit_checks` and is NEVER returned to the client by these helpers (only the eligibility
 * decision + the public attestation hash are surfaced).
 */

export type CreditDecision = {
  wallet_address: string;
  status: CreditStatus;
  attestation_hash: string | null;
  // combined_score is intentionally NOT selected here — it must never reach the client.
};

/**
 * Read the latest credit decision for a wallet from main's `credit_checks` table (one row per
 * evaluation). Eligibility is RECOMPUTED from the stored score + risk tier against the current
 * MIN_ELIGIBLE_SCORE (not the persisted `eligible` flag), so threshold changes apply immediately
 * to already-stored checks. `borrower` is stored un-normalized, so match case-insensitively.
 */
export async function getDecision(wallet: string): Promise<CreditDecision | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("credit_checks")
    .select("borrower, combined_score, risk_tier, attestation_hash")
    .ilike("borrower", wallet)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    borrower: string;
    combined_score: number | null;
    risk_tier: string | null;
    attestation_hash: string | null;
  };
  const approved = (row.combined_score ?? 0) >= MIN_ELIGIBLE_SCORE && row.risk_tier !== "high_default_risk";
  return {
    wallet_address: row.borrower,
    status: approved ? "approved" : "denied",
    attestation_hash: row.attestation_hash,
  };
}

export async function getIdentityByWallet(wallet: string): Promise<EnsIdentity | null> {
  const db = createAdminClient();
  const { data } = await db.from("ens_identities").select("*").eq("wallet_address", wallet.toLowerCase()).maybeSingle();
  return (data as EnsIdentity) ?? null;
}

export async function getIdentityByLabel(label: string): Promise<EnsIdentity | null> {
  const db = createAdminClient();
  const { data } = await db.from("ens_identities").select("*").eq("label", label).maybeSingle();
  return (data as EnsIdentity) ?? null;
}

export async function isLabelTaken(label: string): Promise<boolean> {
  return (await getIdentityByLabel(label)) !== null;
}

export async function insertIdentity(
  row: {
    label: string;
    wallet_address: string;
    full_name: string;
    node: string;
    status: CreditStatus;
    attestation_hash: string | null;
    tx_hash: string;
  } & Partial<Profile>,
): Promise<EnsIdentity> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("ens_identities")
    .insert({ ...row, wallet_address: row.wallet_address.toLowerCase() })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as EnsIdentity;
}

export async function updateProfile(label: string, wallet: string, fields: Profile): Promise<EnsIdentity> {
  const db = createAdminClient();
  // Owner check: only the identity's wallet may edit (status/attestation are not editable here).
  const { data, error } = await db
    .from("ens_identities")
    .update(fields)
    .eq("label", label)
    .eq("wallet_address", wallet.toLowerCase())
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as EnsIdentity;
}

/** Mirror a status change onto an existing issued identity (if any). */
export async function updateIdentityStatus(wallet: string, status: CreditStatus): Promise<EnsIdentity | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("ens_identities")
    .update({ status })
    .eq("wallet_address", wallet.toLowerCase())
    .select("*")
    .maybeSingle();
  return (data as EnsIdentity) ?? null;
}
