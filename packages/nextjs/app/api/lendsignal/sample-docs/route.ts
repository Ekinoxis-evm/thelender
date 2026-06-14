import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

/**
 * GET /api/lendsignal/sample-docs
 *
 * Reads the demo evidence files dropped into `public/docs/` and returns them as
 * base64 documents the onboarding form can preload (then run through the pipeline).
 * Returns an empty list if the folder is missing/empty.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const dir = join(process.cwd(), "public", "docs");
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

    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json({ documents: [] });
  }
}
