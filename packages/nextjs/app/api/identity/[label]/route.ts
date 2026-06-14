import { NextRequest, NextResponse } from "next/server";
import { normalizeLabel } from "~~/lib/kredito";
import { getIdentityByLabel } from "~~/services/kredito/identities";

export const runtime = "nodejs";

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
