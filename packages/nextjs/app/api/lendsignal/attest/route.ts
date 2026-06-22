import { NextRequest, NextResponse } from "next/server";
import { type Hex, hashTypedData, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type CreditAttestation, MAX_ATTESTATION_TTL_SECONDS, riskTierToUint, typedData } from "~~/kredito/attestation";
import { KREDITO_VAULT_ADDRESS } from "~~/kredito/vault";
import { attestMessage, creditLimitUsd } from "~~/lib/kredito";
import { getAttestationInputs } from "~~/services/kredito/identities";
import { verifyWalletControl } from "~~/services/kredito/verifyWallet";
import { MIN_ELIGIBLE_SCORE, tierFromScore } from "~~/services/lendsignal/score";

/**
 * POST /api/lendsignal/attest  { borrower, signature }
 *
 * The PROTOCOL (issuer) signs an EIP-712 CreditAttestation; a vault verifies it onchain to gate
 * lending. SERVER-AUTHORITATIVE: the caller proves control of `borrower` (signs `attestMessage`),
 * then the signed score / risk tier / maxPrincipal / evidence digest are derived from that wallet's
 * latest stored `credit_check` — NEVER from the request body. This prevents a caller from forging a
 * credit line for a score they didn't earn. Signed with ISSUER_PRIVATE_KEY (never reaches the client).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISSUER_PK = process.env.ISSUER_PRIVATE_KEY ?? "";

export async function POST(req: NextRequest) {
  if (!ISSUER_PK) {
    return NextResponse.json(
      { error: "issuer_not_configured", message: "ISSUER_PRIVATE_KEY is not set." },
      { status: 501 },
    );
  }
  // C-1: the signature is bound to a specific vault (domain.verifyingContract). The issuer must know it.
  if (!isAddress(KREDITO_VAULT_ADDRESS)) {
    return NextResponse.json(
      { error: "vault_not_configured", message: "NEXT_PUBLIC_KREDITO_VAULT must be set to the deployed vault." },
      { status: 501 },
    );
  }
  const vault = KREDITO_VAULT_ADDRESS as `0x${string}`;

  let body: { borrower?: string; signature?: Hex };
  try {
    body = (await req.json()) as { borrower?: string; signature?: Hex };
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Body must be JSON." }, { status: 400 });
  }
  const { borrower, signature } = body;
  if (!borrower || !isAddress(borrower)) {
    return NextResponse.json({ error: "invalid_request", message: "Valid borrower required." }, { status: 400 });
  }

  // AuthZ: prove control of `borrower` (EOA + Privy smart wallets via ERC-1271/6492). Without this,
  // anyone could request — and the issuer would sign — an attestation bound to any address.
  if (!(await verifyWalletControl(borrower as `0x${string}`, attestMessage(borrower), signature))) {
    return NextResponse.json(
      { error: "unauthorized", message: "Signature does not prove control of the wallet." },
      { status: 401 },
    );
  }

  // Server-authoritative inputs: read the wallet's latest credit check. The score never came from
  // the client, so it can't be inflated. Eligibility is recomputed against MIN_ELIGIBLE_SCORE.
  const inputs = await getAttestationInputs(borrower);
  if (!inputs) {
    return NextResponse.json(
      { error: "no_credit_check", message: "No completed credit check found for this wallet." },
      { status: 404 },
    );
  }
  const score = Math.max(0, Math.min(1000, Math.round(inputs.score)));
  if (score < MIN_ELIGIBLE_SCORE) {
    return NextResponse.json(
      { error: "not_eligible", message: `Score ${score} is below the eligible threshold (${MIN_ELIGIBLE_SCORE}).` },
      { status: 403 },
    );
  }
  const limitUsd = creditLimitUsd(score);
  if (limitUsd <= 0) {
    return NextResponse.json(
      { error: "not_eligible", message: "Score does not qualify for a credit line." },
      { status: 403 },
    );
  }
  // 6-decimal USDC where $1 == 1e6 units. Limit + tier + evidence are all derived server-side.
  const maxPrincipal = BigInt(limitUsd) * 1_000_000n;

  // H-1: issuer is authoritative over the validity window — issuedAt = now, expiresAt = now + max TTL
  // (always within the vault's cap), independent of the score's longer display validity.
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + MAX_ATTESTATION_TTL_SECONDS;

  const attestation: CreditAttestation = {
    borrower: borrower as `0x${string}`,
    score,
    riskTier: riskTierToUint(tierFromScore(score)),
    evidenceDigest: inputs.evidenceDigest,
    issuedAt,
    expiresAt,
    maxPrincipal,
  };

  try {
    const account = privateKeyToAccount((ISSUER_PK.startsWith("0x") ? ISSUER_PK : `0x${ISSUER_PK}`) as Hex);
    const data = typedData(attestation, vault);
    const sig = await account.signTypedData(data);
    const digest = hashTypedData(data);

    // JSON has no bigint: serialize maxPrincipal as a base-10 string. The client coerces it back.
    return NextResponse.json({
      attestation: { ...attestation, maxPrincipal: attestation.maxPrincipal.toString() },
      signature: sig,
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
