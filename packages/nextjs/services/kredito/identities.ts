import "server-only";
import type { CreditStatus, EnsIdentity } from "~~/lib/kredito";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * Server-only data access for KreditoOne. Uses the service-role client (bypasses RLS) because the
 * app authenticates with Privy, not Supabase Auth. The private credit SCORE lives in
 * `credit_decisions` and is NEVER returned to the client by these helpers.
 */

export type CreditDecision = {
  wallet_address: string;
  status: CreditStatus;
  attestation_hash: string | null;
  // combined_score is intentionally NOT selected here — it must never reach the client.
};

export async function getDecision(wallet: string): Promise<CreditDecision | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("credit_decisions")
    .select("wallet_address, status, attestation_hash")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  return (data as CreditDecision) ?? null;
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

export async function insertIdentity(row: {
  label: string;
  wallet_address: string;
  full_name: string;
  node: string;
  status: CreditStatus;
  attestation_hash: string | null;
  tx_hash: string;
  url?: string | null;
  twitter?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
}): Promise<EnsIdentity> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("ens_identities")
    .insert({ ...row, wallet_address: row.wallet_address.toLowerCase() })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as EnsIdentity;
}

export async function updateProfile(
  label: string,
  wallet: string,
  fields: { url?: string; twitter?: string; avatar_url?: string; display_name?: string },
): Promise<EnsIdentity> {
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
