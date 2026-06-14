import { NextRequest, NextResponse } from "next/server";
import { type Hex, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type CreditAttestation, MAX_ATTESTATION_TTL_SECONDS, riskTierToUint, typedData } from "~~/kredito/attestation";
import { KREDITO_VAULT_ADDRESS } from "~~/kredito/vault";
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
  /** H-2: issuer-bound max loan size (asset units as a base-10 string, e.g. USDC 6-decimals). */
  maxPrincipal: string;
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
    !isBytes32(body.evidenceDigest) ||
    typeof body.maxPrincipal !== "string"
  ) {
    return NextResponse.json(
      { error: "invalid_request", message: "borrower/score/evidenceDigest/expiresAt/maxPrincipal required." },
      { status: 400 },
    );
  }

  // C-1: the signature is bound to a specific vault (domain.verifyingContract). The issuer must know it.
  if (!isAddress(KREDITO_VAULT_ADDRESS)) {
    return NextResponse.json(
      { error: "vault_not_configured", message: "NEXT_PUBLIC_KREDITO_VAULT must be set to the deployed vault." },
      { status: 501 },
    );
  }

  let maxPrincipal: bigint;
  try {
    maxPrincipal = BigInt(body.maxPrincipal);
    if (maxPrincipal <= 0n) throw new Error("maxPrincipal must be positive");
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "maxPrincipal must be a positive base-10 integer string." },
      { status: 400 },
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  // H-1: the vault rejects windows longer than MAX_ATTESTATION_TTL; reject early with a clear message.
  if (body.expiresAt <= issuedAt || body.expiresAt - issuedAt > MAX_ATTESTATION_TTL_SECONDS) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: `expiresAt must be in the future and within ${MAX_ATTESTATION_TTL_SECONDS}s of now.`,
      },
      { status: 400 },
    );
  }

  const attestation: CreditAttestation = {
    borrower: body.borrower,
    score: Math.max(0, Math.min(1000, Math.round(body.score))),
    riskTier: riskTierToUint(body.riskTier),
    evidenceDigest: body.evidenceDigest,
    issuedAt,
    expiresAt: body.expiresAt,
    maxPrincipal,
  };

  try {
    const account = privateKeyToAccount((ISSUER_PK.startsWith("0x") ? ISSUER_PK : `0x${ISSUER_PK}`) as Hex);
    const data = typedData(attestation, KREDITO_VAULT_ADDRESS);
    const signature = await account.signTypedData(data);
    const digest = hashTypedData(data);

    // JSON has no bigint: serialize maxPrincipal as a base-10 string. The client coerces it back to
    // bigint before encoding the borrow tuple / signing payload.
    return NextResponse.json({
      attestation: { ...attestation, maxPrincipal: attestation.maxPrincipal.toString() },
      signature,
      issuer: account.address,
      digest,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "sign_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
