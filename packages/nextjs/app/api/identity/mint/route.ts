import { NextRequest, NextResponse } from "next/server";
import { type Hex, createPublicClient, createWalletClient, http, isAddress, publicActions } from "viem";
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

export const runtime = "nodejs";

function sepoliaRpc() {
  const key = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : "https://ethereum-sepolia-rpc.publicnode.com";
}

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

  // AuthN: the caller must prove control of `wallet` by signing the bound message. verifyMessage
  // handles EOA + Privy smart wallets (ERC-1271/6492). Mint is idempotent, so replay is harmless.
  const reader = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc()) });
  let proven = false;
  if (signature) {
    try {
      proven = await reader.verifyMessage({ address: wallet, message: mintMessage(wallet, label), signature });
    } catch {
      proven = false;
    }
  }
  if (!proven) {
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
    return NextResponse.json({ error: `Mint failed: ${(e as Error).message}` }, { status: 502 });
  }

  const clean = sanitizeProfile(profile);
  const identity = await insertIdentity({
    label,
    wallet_address: wallet,
    full_name: fullName(label),
    node: labelToNode(label),
    status: "approved",
    attestation_hash: decision.attestation_hash,
    tx_hash: txHash,
    url: clean.url,
    twitter: clean.twitter,
    avatar_url: clean.avatar_url,
    display_name: clean.display_name,
  });

  return NextResponse.json({ identity, txHash });
}
