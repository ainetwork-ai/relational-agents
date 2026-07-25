import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { isOkfId } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

/** POST → deep-duplicate a page (blocks + child pages), "Title (copy)",
 * positioned right after the original. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (isOkfId(pageId))
    return NextResponse.json({ error: "Not supported for file pages" }, { status: 400 });

  const [src] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = auth.user.id; // narrowed here; the closure below can't re-narrow

  async function copyTree(srcPageId: string, parentPageId: string | null, titleSuffix: string, position: number): Promise<string> {
    const [orig] = await db.select().from(pages).where(eq(pages.id, srcPageId)).limit(1);
    const newId = randomUUID();
    await db.insert(pages).values({
      id: newId,
      workspaceId: orig.workspaceId,
      parentPageId,
      teamspaceId: orig.teamspaceId,
      title: `${orig.title}${titleSuffix}`,
      icon: orig.icon,
      coverUrl: orig.coverUrl,
      isArchived: false,
      isFavorite: false,
      fullWidth: orig.fullWidth,
      isLocked: false,
      position,
      createdBy: userId,
    });
 // blocks: two passes so nested parentBlockId links remap to the new ids
    const rows = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, srcPageId))
      .orderBy(asc(blocks.position));
    const idMap = new Map<string, string>(rows.map((b) => [b.id, randomUUID()]));
    if (rows.length) {
      await db.insert(blocks).values(
        rows.map((b) => ({
          id: idMap.get(b.id)!,
          pageId: newId,
          type: b.type,
          content: b.content,
          parentBlockId: b.parentBlockId ? (idMap.get(b.parentBlockId) ?? null) : null,
          position: b.position,
        }))
      );
    }
 // child pages recurse (keep their own titles)
    const kids = await db
      .select()
      .from(pages)
      .where(eq(pages.parentPageId, srcPageId))
      .orderBy(asc(pages.position));
    for (const k of kids) {
      if (k.isArchived) continue;
      await copyTree(k.id, newId, "", k.position);
    }
    return newId;
  }

  const newId = await copyTree(pageId, src.parentPageId, " (copy)", src.position + 0.5);
  const [page] = await db.select().from(pages).where(eq(pages.id, newId)).limit(1);
  return NextResponse.json({ page }, { status: 201 });
}
