import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

/**
 * GET /api/lendsignal/sample-docs?case=success|risk
 *
 * Reads the demo evidence files for a use case from public/docs/<case>/ and returns
 * them as base64 documents the onboarding form can preload (then run through the
 * pipeline). Returns an empty list if the folder is missing/empty.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CASES = new Set(["success", "risk"]);

const MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("case") ?? "success";
  const useCase = CASES.has(requested) ? requested : "success";

  try {
    const dir = join(process.cwd(), "public", "docs", useCase);
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10);

    const documents = await Promise.all(
      files.map(async f => {
        const buf = await readFile(join(dir, f.name));
        const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
        return {
          filename: f.name,
          contentType: MIME[ext] ?? "application/octet-stream",
          contentBase64: buf.toString("base64"),
        };
      }),
    );

    return NextResponse.json({ case: useCase, documents });
  } catch {
    return NextResponse.json({ case: useCase, documents: [] });
  }
}
