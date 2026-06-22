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

  // Always scope to a single wallet — never return the whole table. (`borrower` is matched
  // case-insensitively, consistent with getDecision / the evaluation route.)
  if (!borrower || !/^0x[0-9a-fA-F]{40}$/.test(borrower)) {
    return NextResponse.json({ checks: [], configured: true, error: "borrower required" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const query = supabase
      .from("credit_checks")
      .select(COLUMNS)
      .ilike("borrower", borrower)
      .order("created_at", { ascending: false })
      .limit(limit);

    const { data, error } = await query;
    if (error) return NextResponse.json({ checks: [], configured: true, error: error.message });
    return NextResponse.json({ checks: data ?? [], configured: true });
  } catch (e) {
    return NextResponse.json({ checks: [], configured: true, error: e instanceof Error ? e.message : String(e) });
  }
}
