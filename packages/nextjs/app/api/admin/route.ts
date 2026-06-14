import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { type AiConfig, getAdminOverview, getAiConfig, saveAiConfig } from "~~/services/kredito/admin";

export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const token = req.headers.get("x-admin-secret") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET /api/admin — live status (credit checks + identities) + the active AI config. */
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [overview, aiConfig] = await Promise.all([getAdminOverview(), getAiConfig()]);
  return NextResponse.json({ overview, aiConfig });
}

/** POST /api/admin — save a new active AI config (model + system prompts). */
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Partial<AiConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  await saveAiConfig(body);
  return NextResponse.json({ ok: true });
}
