import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { createAdminClient } from "~~/services/supabase/admin";

/**
 * GET /api/lendsignal/evaluation?inferenceId=<id>&borrower=0x..
 *
 * SERVER ONLY (service-role; the tables have RLS with no public policies). Returns the
 * credit_checks row for `inferenceId` PLUS its per-document analyses. The requesting
 * `borrower` MUST match the row's borrower — a wallet can only read its own evaluation.
 *
 * Privacy boundary: NEVER returns prompts/system_prompts or raw documents. The per-doc
 * `output` is parsed into a small analysis object (signal/finding/bands) before returning.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_COLUMNS =
  "id,created_at,borrower,inference_id,model,attested,combined_score,ai_score,risk_tier,eligible,attestation_hash,evidence_digest,legal_name,country,enterprise_type";
// NOTE: prompt + system_prompt are intentionally excluded from the projection.
const DOC_COLUMNS = "id,created_at,inference_id,filename,document_type,status,section_score,output";

// Tolerate either shape the section parser may have written into `output`.
type ParsedDocAnalysis = {
  signal?: string;
  finding?: string;
  authenticity?: string;
  consistency?: string;
  reliable?: boolean;
  documentType?: string;
};

const parseOutput = (output: unknown): ParsedDocAnalysis | null => {
  if (typeof output !== "string" || !output.trim()) return null;
  try {
    const json = JSON.parse(output) as Record<string, unknown>;
    return {
      signal: typeof json.signal === "string" ? json.signal : undefined,
      finding: typeof json.finding === "string" ? json.finding : undefined,
      authenticity: typeof json.authenticity === "string" ? json.authenticity : undefined,
      consistency: typeof json.consistency === "string" ? json.consistency : undefined,
      reliable: typeof json.reliable === "boolean" ? json.reliable : undefined,
      documentType: typeof json.documentType === "string" ? json.documentType : undefined,
    };
  } catch {
    // Non-JSON output — surface nothing structured (UI falls back to section score only).
    return null;
  }
};

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ configured: false, error: "supabase_unconfigured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const inferenceId = searchParams.get("inferenceId");
  const borrower = searchParams.get("borrower");

  if (!inferenceId) {
    return NextResponse.json({ error: "inferenceId is required" }, { status: 400 });
  }
  if (!borrower || !isAddress(borrower)) {
    return NextResponse.json({ error: "a valid borrower address is required" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data: check, error: checkErr } = await supabase
      .from("credit_checks")
      .select(CHECK_COLUMNS)
      .eq("inference_id", inferenceId)
      .maybeSingle();

    if (checkErr) return NextResponse.json({ error: checkErr.message }, { status: 500 });
    if (!check) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Ownership gate: the requesting wallet must own this evaluation.
    if (!check.borrower || String(check.borrower).toLowerCase() !== borrower.toLowerCase()) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // The per-document rows aren't FK-linked to the reduce id, but they share the borrower and were
    // written in the same /finish call. Match by borrower within a window around the check's time.
    const checkedAt = new Date(check.created_at).getTime();
    const windowMs = 30 * 60 * 1000;
    const from = new Date(checkedAt - windowMs).toISOString();
    const to = new Date(checkedAt + windowMs).toISOString();

    const { data: docs, error: docErr } = await supabase
      .from("document_inferences")
      .select(DOC_COLUMNS)
      .eq("borrower", check.borrower)
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: true });

    const documents = (docErr ? [] : (docs ?? [])).map(d => ({
      id: d.id,
      inference_id: d.inference_id,
      filename: d.filename,
      document_type: d.document_type,
      status: d.status,
      section_score: d.section_score,
      analysis: parseOutput(d.output),
    }));

    return NextResponse.json({ configured: true, check, documents });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
