import { NextRequest, NextResponse } from "next/server";
import { getInference } from "~~/services/lendsignal/confidentialAi";

/**
 * GET /api/lendsignal/inference/:id
 *
 * Look up a Confidential AI request by id. The id is bound to the API key, so we
 * proxy the call server-side (the key never reaches the client) and return the
 * attested inference snapshot. Note: results are retained ~30 min by the attester.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{20,}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id", message: "Not a Confidential AI request id." }, { status: 400 });
  }
  try {
    const snapshot = await getInference(id);
    return NextResponse.json(snapshot);
  } catch (e) {
    return NextResponse.json(
      { error: "lookup_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
