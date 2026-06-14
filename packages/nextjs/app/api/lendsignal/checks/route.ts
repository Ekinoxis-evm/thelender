import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * GET /api/lendsignal/checks?borrower=0x..&limit=10
 *
 * Recent stored credit checks (read via the service-role key — the table has RLS
 * with no public policies). Returns an empty list when Supabase isn't configured
 * or the table doesn't exist yet, so the UI degrades gracefully.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id,created_at,borrower,inference_id,model,attested,combined_score,risk_tier,eligible";

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ checks: [], configured: false });
  }

  const { searchParams } = new URL(req.url);
  const borrower = searchParams.get("borrower");
  const limit = Math.min(Number(searchParams.get("limit") ?? 10) || 10, 50);

  try {
    const supabase = createAdminClient();
    let query = supabase.from("credit_checks").select(COLUMNS).order("created_at", { ascending: false }).limit(limit);
    if (borrower) query = query.eq("borrower", borrower);

    const { data, error } = await query;
    if (error) return NextResponse.json({ checks: [], configured: true, error: error.message });
    return NextResponse.json({ checks: data ?? [], configured: true });
  } catch (e) {
    return NextResponse.json({ checks: [], configured: true, error: e instanceof Error ? e.message : String(e) });
  }
}
