import { NextRequest, NextResponse } from "next/server";
import { type Hex, createWalletClient, http, isAddress, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { fullName, kreditoControllerAbi, labelToNode, normalizeLabel } from "~~/lib/kredito";
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
  let body: { wallet?: string; label?: string; profile?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wallet, label: rawLabel, profile } = body;

  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Valid wallet required" }, { status: 400 });
  }
  let label: string;
  try {
    label = normalizeLabel(String(rawLabel ?? ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
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

  const identity = await insertIdentity({
    label,
    wallet_address: wallet,
    full_name: fullName(label),
    node: labelToNode(label),
    status: "approved",
    attestation_hash: decision.attestation_hash,
    tx_hash: txHash,
    url: profile?.url ?? null,
    twitter: profile?.twitter ?? null,
    avatar_url: profile?.avatar_url ?? null,
    display_name: profile?.display_name ?? null,
  });

  return NextResponse.json({ identity, txHash });
}
