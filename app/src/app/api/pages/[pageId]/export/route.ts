import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { blocksToMarkdown, type ParsedBlock } from "@/lib/memory-parse";
import { isOkfId, decodeId, readNode } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** GET → the page as a downloadable Markdown file (Notion: ... → Export). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;

  let title = "Untitled";
  let parsed: ParsedBlock[] = [];

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
    }));
  }

  const md = blocksToMarkdown(title, parsed);
  const safe = (title || "Untitled").replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
  return new NextResponse(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe)}.md`,
    },
  });
}
