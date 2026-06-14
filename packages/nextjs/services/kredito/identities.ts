import "server-only";
import type { CreditStatus, EnsIdentity, Profile } from "~~/lib/kredito";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * Server-only data access for Kreditos. Uses the service-role client (bypasses RLS) because the
 * app authenticates with Privy, not Supabase Auth. The private credit score lives in the
 * `credit_checks` table (written by the Confidential-AI score pipeline) and is NEVER returned to
 * the client by these helpers — only the eligibility decision + attestation hash leave the server.
 */

export type CreditDecision = {
  borrower: string;
  status: CreditStatus; // derived from credit_checks.eligible
  attestation_hash: string | null; // the Chainlink attestation = the ENS "financial ID"
};

/** Latest credit decision for a wallet, read from the score pipeline's `credit_checks` table. */
export async function getDecision(wallet: string): Promise<CreditDecision | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("credit_checks")
    .select("borrower, eligible, attestation_hash")
    .eq("borrower", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { borrower: string; eligible: boolean | null; attestation_hash: string | null };
  return {
    borrower: row.borrower,
    status: row.eligible ? "approved" : "denied",
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
