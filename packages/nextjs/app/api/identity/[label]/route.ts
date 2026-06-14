import { NextRequest, NextResponse } from "next/server";
import { type Hex, createPublicClient, http, isAddress } from "viem";
import { sepolia } from "viem/chains";
import {
  EDIT_TTL_MS,
  type ProfileInput,
  editMessage,
  normalizeLabel,
  profileDigest,
  sanitizeProfile,
} from "~~/lib/kredito";
import { getIdentityByLabel, updateProfile } from "~~/services/kredito/identities";

export const runtime = "nodejs";

function sepoliaRpc() {
  const key = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : "https://ethereum-sepolia-rpc.publicnode.com";
}

/**
 * GET /api/identity/<label> — public, stable read for the profile card. Returns the non-sensitive
 * identity record (status + profile); never the credit score.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ label: string }> }) {
  const { label: raw } = await params;
  let label: string;
  try {
    label = normalizeLabel(raw);
  } catch {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }
  const identity = await getIdentityByLabel(label);
  if (!identity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ identity });
}

/**
 * PATCH /api/identity/<label> — owner edits their profile mirror. The on-chain resolver.setTexts is
 * the canonical write (owner-gated by the resolver); this mirrors it to Supabase for fast rendering.
 * Requires a signed editMessage proving control of the wallet, and that wallet must own the identity.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ label: string }> }) {
  const { label: raw } = await params;
  let label: string;
  try {
    label = normalizeLabel(raw);
  } catch {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  let body: { wallet?: string; profile?: ProfileInput; signature?: Hex; issuedAt?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wallet, profile, signature, issuedAt } = body;
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Valid wallet required" }, { status: 400 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Signature required" }, { status: 401 });
  }
  if (typeof issuedAt !== "number" || Math.abs(Date.now() - issuedAt) > EDIT_TTL_MS) {
    return NextResponse.json({ error: "Stale or missing issuedAt" }, { status: 401 });
  }

  const identity = await getIdentityByLabel(label);
  if (!identity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (identity.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
    return NextResponse.json({ error: "Not the owner of this identity" }, { status: 403 });
  }

  // Verify the signature commits to THIS exact profile content + timestamp (content-bound + TTL'd → replay-proof).
  const clean = sanitizeProfile(profile);
  const reader = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc()) });
  let proven = false;
  try {
    proven = await reader.verifyMessage({
      address: wallet,
      message: editMessage(wallet, label, profileDigest(clean), issuedAt),
      signature,
    });
  } catch {
    proven = false;
  }
  if (!proven) {
    return NextResponse.json({ error: "Signature does not prove control of the wallet" }, { status: 401 });
  }

  const updated = await updateProfile(label, wallet, clean);
  return NextResponse.json({ identity: updated });
}
