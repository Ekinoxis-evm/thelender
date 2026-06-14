import { NextRequest, NextResponse } from "next/server";
import { isRegistryConfigured, issueCertificateOnchain } from "~~/services/lendsignal/registry";
import type { ScoreInputs } from "~~/services/lendsignal/types";

/**
 * POST /api/lendsignal/issue
 *
 * Issues (or updates) the borrower's onchain Credit Certificate. Signed server-side
 * with the issuer key because `issueCertificate` is `onlyIssuer` — the protocol
 * certifies the business. Returns the Sepolia tx hash.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  borrower: `0x${string}`;
  scoreInputs: ScoreInputs;
};

const isAddress = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

export async function POST(req: NextRequest) {
  if (!isRegistryConfigured()) {
    return NextResponse.json(
      {
        error: "registry_not_configured",
        message:
          "Onchain issuance is not wired yet. Deploy CreditCertificateRegistry to Sepolia and set NEXT_PUBLIC_CERTIFICATE_REGISTRY + ISSUER_PRIVATE_KEY.",
      },
      { status: 501 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Body must be JSON." }, { status: 400 });
  }

  const { borrower, scoreInputs } = body;
  if (!isAddress(borrower)) {
    return NextResponse.json({ error: "invalid_request", message: "borrower must be an address." }, { status: 400 });
  }
  if (
    !scoreInputs ||
    typeof scoreInputs.confidentialAiScore !== "number" ||
    typeof scoreInputs.bureauScore !== "number" ||
    !scoreInputs.attestationHash ||
    !scoreInputs.expiresAt
  ) {
    return NextResponse.json({ error: "invalid_request", message: "scoreInputs is incomplete." }, { status: 400 });
  }

  try {
    const result = await issueCertificateOnchain(borrower, scoreInputs);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "issue_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
