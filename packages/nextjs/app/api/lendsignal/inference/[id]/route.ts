import { NextRequest, NextResponse } from "next/server";
import { getInference } from "~~/services/lendsignal/confidentialAi";

/**
 * GET /api/lendsignal/inference/:id
 *
 * Public, verifiable TEE-proof view. We proxy the Confidential AI snapshot server-side (the API key
 * never reaches the client) but REDACT the private analysis content — the plaintext model `output`
 * and the `prompt`/`system_prompt` — keeping only the cryptographic proof (model, status, usage,
 * timings, and the input/request/response digests). That preserves "anyone can verify what ran on
 * what data" without exposing the borrower's confidential assessment to anyone holding the id. The
 * owner still sees their full per-document analysis via the ownership-gated /evaluation route.
 * Note: results are retained ~30 min by the attester.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private fields stripped from the public proof response.
const REDACTED = ["output", "prompt", "system_prompt", "messages"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{20,}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id", message: "Not a Confidential AI request id." }, { status: 400 });
  }
  try {
    const snapshot = (await getInference(id)) as Record<string, unknown>;
    for (const k of REDACTED) delete snapshot[k];
    return NextResponse.json(snapshot);
  } catch (e) {
    return NextResponse.json(
      { error: "lookup_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
