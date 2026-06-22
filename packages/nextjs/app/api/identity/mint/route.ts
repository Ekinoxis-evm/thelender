import { NextRequest, NextResponse } from "next/server";
import { type Hex, createWalletClient, http, isAddress, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  fullName,
  kreditoControllerAbi,
  labelToNode,
  mintMessage,
  normalizeLabel,
  sanitizeProfile,
} from "~~/lib/kredito";
import { getDecision, insertIdentity, isLabelTaken } from "~~/services/kredito/identities";
import { sepoliaRpc, verifyWalletControl } from "~~/services/kredito/verifyWallet";

export const runtime = "nodejs";

/**
 * POST /api/identity/mint — the issuer (backend) mints `<label>.kredito.eth` to an APPROVED wallet.
 * Backend-submit (no voucher): holding the ISSUER_ROLE key is the authorization. The private score
 * is never touched here; only the approval decision + attestation hash are read.
 */
export async function POST(req: NextRequest) {
  let body: { wallet?: string; label?: string; profile?: Record<string, string>; signature?: Hex };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wallet, label: rawLabel, profile, signature } = body;

  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Valid wallet required" }, { status: 400 });
  }
  let label: string;
  try {
    label = normalizeLabel(String(rawLabel ?? ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // AuthN: the caller must prove control of `wallet` by signing the bound message (EOA + Privy
  // smart wallets via ERC-1271/6492). Mint is idempotent, so replay is harmless.
  if (!(await verifyWalletControl(wallet as `0x${string}`, mintMessage(wallet, label), signature))) {
    return NextResponse.json({ error: "Signature does not prove control of the wallet" }, { status: 401 });
  }

  const decision = await getDecision(wallet);
  if (!decision || decision.status !== "approved") {
    return NextResponse.json({ error: "Wallet is not approved for a Kredito identity" }, { status: 403 });
  }
  if (await isLabelTaken(label)) {
    return NextResponse.json({ error: "Label already taken" }, { status: 409 });
  }

  const controller = process.env.NEXT_PUBLIC_KREDITO_CONTROLLER as Hex | undefined;
  const issuerKey = process.env.ISSUER_PRIVATE_KEY as Hex | undefined;
  if (!controller || !issuerKey) {
    return NextResponse.json(
      { error: "Issuer not configured (set NEXT_PUBLIC_KREDITO_CONTROLLER and ISSUER_PRIVATE_KEY)" },
      { status: 503 },
    );
  }

  const account = privateKeyToAccount(issuerKey);
  const client = createWalletClient({ account, chain: sepolia, transport: http(sepoliaRpc()) }).extend(publicActions);

  // Onchain availability check — the controller's `issued` mapping is the source of truth and can
  // be ahead of the Supabase mirror (e.g. minted before persistence). Catches it before spending gas.
  const node = labelToNode(label);
  try {
    const taken = await client.readContract({
      address: controller,
      abi: kreditoControllerAbi,
      functionName: "issued",
      args: [node],
    });
    if (taken) {
      return NextResponse.json(
        { error: "label_taken", message: `${fullName(label)} is already taken — choose another name.` },
        { status: 409 },
      );
    }
  } catch {
    // Non-fatal: if the read fails, fall through — the onchain mint still guards with AlreadyIssued.
  }

  let txHash: Hex;
  try {
    txHash = await client.writeContract({
      address: controller,
      abi: kreditoControllerAbi,
      functionName: "mint",
      args: [label, wallet, decision.attestation_hash ?? ""],
    });
    await client.waitForTransactionReceipt({ hash: txHash });
  } catch (e) {
    // AlreadyIssued (0x52bf3fc8) → friendly "name taken"; otherwise surface the message.
    const msg = (e as Error).message ?? "";
    if (/AlreadyIssued|0x52bf3fc8|already/i.test(msg)) {
      return NextResponse.json(
        { error: "label_taken", message: `${fullName(label)} is already taken — choose another name.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Mint failed: ${msg}` }, { status: 502 });
  }

  // The onchain mint already succeeded — mirroring to Supabase is best-effort. Never 500 the whole
  // request (and lose the txHash) on a mirror hiccup; the profile step can re-sync the row.
  const clean = sanitizeProfile(profile);
  let identity = null;
  try {
    identity = await insertIdentity({
      label,
      wallet_address: wallet,
      full_name: fullName(label),
      node,
      status: "approved",
      attestation_hash: decision.attestation_hash,
      tx_hash: txHash,
      ...clean,
    });
  } catch (e) {
    console.warn("[mint] identity minted onchain but mirror insert failed:", (e as Error).message);
  }

  return NextResponse.json({ identity, txHash });
}
