import { NextResponse } from "next/server";

/**
 * GET /api/lendsignal/ai-health — diagnostic: does the Confidential AI key work
 * from this deployment? Calls GET /v1/models. Returns the status without exposing
 * the key (only its length + the upstream status/body snippet).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.CHAINLINK_CONFIDENTIAL_AI_BASE_URL ?? "https://confidential-ai-dev-preview.cldev.cloud";
  const key = process.env.CHAINLINK_CONFIDENTIAL_AI_API_KEY ?? "";
  const model = process.env.CHAINLINK_CONFIDENTIAL_AI_MODEL ?? "(default gemma4)";

  if (!key) {
    return NextResponse.json({
      configured: false,
      baseUrl: base,
      model,
      note: "CHAINLINK_CONFIDENTIAL_AI_API_KEY is empty in this environment.",
    });
  }

  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const body = await res.text();
    return NextResponse.json({
      configured: true,
      keyLength: key.length,
      baseUrl: base,
      model,
      upstreamStatus: res.status,
      upstreamOk: res.ok,
      upstreamBody: body.slice(0, 300),
    });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      keyLength: key.length,
      baseUrl: base,
      model,
      fetchError: e instanceof Error ? e.message : String(e),
    });
  }
}
