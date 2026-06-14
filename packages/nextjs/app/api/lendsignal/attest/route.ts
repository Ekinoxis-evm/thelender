import { NextRequest, NextResponse } from "next/server";
import { type Hex, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type CreditAttestation, riskTierToUint, typedData } from "~~/kredito/attestation";
import type { RiskTier } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/attest
 *
 * Option B: the PROTOCOL (issuer) signs an EIP-712 CreditAttestation over the score.
 * The signature is the trust anchor — a vault verifies it onchain (recovers the
 * signer == issuer) to gate lending. The borrower cannot forge it. No certificate
 * registry needed; ENS carries the identity.
 *
 * Signed server-side with ISSUER_PRIVATE_KEY (never reaches the client).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISSUER_PK = process.env.ISSUER_PRIVATE_KEY ?? "";

type Body = {
  borrower: `0x${string}`;
  score: number;
  riskTier: RiskTier;
  evidenceDigest: `0x${string}`;
  expiresAt: number;
};

const isAddress = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isBytes32 = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

export async function POST(req: NextRequest) {
  if (!ISSUER_PK) {
    return NextResponse.json(
      { error: "issuer_not_configured", message: "ISSUER_PRIVATE_KEY is not set." },
      { status: 501 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Body must be JSON." }, { status: 400 });
  }

  if (
    !isAddress(body.borrower) ||
    typeof body.score !== "number" ||
    !body.expiresAt ||
    !isBytes32(body.evidenceDigest)
  ) {
    return NextResponse.json(
      { error: "invalid_request", message: "borrower/score/evidenceDigest/expiresAt required." },
      { status: 400 },
    );
  }

  const attestation: CreditAttestation = {
    borrower: body.borrower,
    score: Math.max(0, Math.min(1000, Math.round(body.score))),
    riskTier: riskTierToUint(body.riskTier),
    evidenceDigest: body.evidenceDigest,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: body.expiresAt,
  };

  try {
    const account = privateKeyToAccount((ISSUER_PK.startsWith("0x") ? ISSUER_PK : `0x${ISSUER_PK}`) as Hex);
    const data = typedData(attestation);
    const signature = await account.signTypedData(data);
    const digest = hashTypedData(data);

    return NextResponse.json({ attestation, signature, issuer: account.address, digest });
  } catch (e) {
    return NextResponse.json(
      { error: "sign_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
