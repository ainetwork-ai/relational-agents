import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import type { ParsedBlock } from "@/lib/memory-parse";
import { blocksToHtml, type ExportBlock } from "@/lib/export-html";
import { isOkfId, decodeId, readNode } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

// one headless browser per server process, launched on first PDF export.
// chromium comes via @playwright/test (the only playwright package that is a
// direct dependency under pnpm's strict node_modules).
let browserPromise: Promise<import("@playwright/test").Browser> | null = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = import("@playwright/test").then(({ chromium }) =>
      chromium.launch({ headless: true })
    );
  }
  return browserPromise;
}

/** GET → the page as a real PDF. Rendered by a
 * server-side headless chromium from self-contained HTML (no app auth). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  let title = "Untitled";
  let parsed: ExportBlock[] = [];
  if (isOkfId(pageId)) {
    const node = readNode(decodeId(pageId));
    if (!node) return NextResponse.json({ error: "Not found" }, { status: 404 });
    title = node.title;
    parsed = node.kind === "page" || node.kind === "row" ? node.blocks : [];
  } else {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
    title = page.title || "Untitled";
    const rows = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, pageId))
      .orderBy(asc(blocks.position));
    parsed = rows.map((b, i) => ({
      id: b.id,
      type: b.type as ParsedBlock["type"],
      content: b.content as ParsedBlock["content"],
      position: b.position ?? i + 1,
      parentBlockId: b.parentBlockId,
    })) as ExportBlock[];
  }

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(blocksToHtml(title, parsed), { waitUntil: "networkidle" });
      const pdf = await page.pdf({ format: "A4", margin: { top: "18mm", bottom: "18mm" } });
      const safe = (title || "Untitled").replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe)}.pdf`,
        },
      });
    } finally {
      await page.close();
    }
  } catch (err) {
    console.error("pdf export failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PDF rendering unavailable" }, { status: 500 });
  }
}
