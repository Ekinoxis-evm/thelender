import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { type Hex, createWalletClient, http, isAddress, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { CreditStatus } from "~~/lib/kredito";
import { kreditoControllerAbi } from "~~/lib/kredito";
import { getIdentityByWallet, updateIdentityStatus, upsertDecision } from "~~/services/kredito/identities";

export const runtime = "nodejs";

/**
 * STABLE INGESTION ENDPOINT — POST /api/cre/decision
 *
 * The Chainlink CRE workflow (+ Confidential-AI-Attester) calls this with an attested credit
 * decision. Versioned, bearer-authenticated contract so the CRE branch can integrate against it
 * regardless of which branch it ships from. See docs/kredito-cre-ingest.md.
 *
 * On `approved` the wallet becomes eligible to mint its `<label>.kredito.eth` identity. If the
 * wallet already minted, a status change (denied/defaulted) is synced to the on-chain
 * `kredito.status` credential via KreditoController.setStatus. The private score never leaves here.
 */

const DECISIONS = ["approved", "denied", "review", "defaulted", "pending"] as const;

type Payload = {
  version?: number;
  wallet?: string;
  decision?: string;
  scores?: { combined?: number; confidential_ai?: number; bureau?: number };
  risk_tier?: string;
  attestation_hash?: string;
  bureau_report_hash?: string;
  evidence_digest?: string;
  expires_at?: number;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRE_INGEST_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sepoliaRpc() {
  const key = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : "https://ethereum-sepolia-rpc.publicnode.com";
}

const score = (v: unknown): number | null => (typeof v === "number" && v >= 0 && v <= 1000 ? Math.round(v) : null);

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.version !== 1) {
    return NextResponse.json({ error: "Unsupported version (expected 1)" }, { status: 400 });
  }
  const wallet = body.wallet;
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Valid wallet required" }, { status: 400 });
  }
  if (!body.decision || !DECISIONS.includes(body.decision as (typeof DECISIONS)[number])) {
    return NextResponse.json({ error: `decision must be one of ${DECISIONS.join(", ")}` }, { status: 400 });
  }
  const decision = body.decision as CreditStatus;
  const riskTier =
    body.risk_tier === "low" || body.risk_tier === "medium" || body.risk_tier === "high" ? body.risk_tier : null;
  const expiresAt = typeof body.expires_at === "number" ? new Date(body.expires_at * 1000).toISOString() : null;

  await upsertDecision({
    wallet_address: wallet,
    status: decision,
    combined_score: score(body.scores?.combined),
    confidential_ai_score: score(body.scores?.confidential_ai),
    bureau_score: score(body.scores?.bureau),
    risk_tier: riskTier,
    attestation_hash: body.attestation_hash ?? null,
    bureau_report_hash: body.bureau_report_hash ?? null,
    evidence_digest: body.evidence_digest ?? null,
    expires_at: expiresAt,
  });

  // If the wallet already minted, sync the mirror + the on-chain credential.
  const identity = await getIdentityByWallet(wallet);
  let chainSynced = false;
  if (identity && identity.status !== decision) {
    await updateIdentityStatus(wallet, decision);
    const controller = process.env.NEXT_PUBLIC_KREDITO_CONTROLLER as Hex | undefined;
    const issuerKey = process.env.ISSUER_PRIVATE_KEY as Hex | undefined;
    if (controller && issuerKey) {
      try {
        const account = privateKeyToAccount(issuerKey);
        const client = createWalletClient({ account, chain: sepolia, transport: http(sepoliaRpc()) }).extend(
          publicActions,
        );
        const hash = await client.writeContract({
          address: controller,
          abi: kreditoControllerAbi,
          functionName: "setStatus",
          args: [identity.label, decision],
        });
        await client.waitForTransactionReceipt({ hash });
        chainSynced = true;
      } catch {
        chainSynced = false; // best-effort: DB is the source of truth, chain is the credential mirror
      }
    }
  }

  return NextResponse.json({ ok: true, wallet, status: decision, hasIdentity: !!identity, chainSynced });
}
