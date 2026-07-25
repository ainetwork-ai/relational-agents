import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages } from "@/lib/db/schema";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { listPages } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** GET /api/search?q= → { results: [{ id, title, icon, snippet }] } */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ results: [] });
  // Notion-style result filters: type (page|database), edited window, creator
  const fType = sp.get("type") ?? "";
  const fEdited = sp.get("edited") ?? "";
  const fCreator = sp.get("creator") ?? "";
  const editedCutoff = (() => {
    const d = new Date();
    if (fEdited === "today") d.setHours(0, 0, 0, 0);
    else if (fEdited === "week") d.setDate(d.getDate() - 7);
    else if (fEdited === "month") d.setMonth(d.getMonth() - 1);
    else return null;
    return d;
  })();

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ results: [] });

  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  // pages whose block text matches
  const blockHits = await db
    .select({
      pageId: blocks.pageId,
      text: sql<string>`${blocks.content} ->> 'text'`,
    })
    .from(blocks)
    .innerJoin(pages, eq(blocks.pageId, pages.id))
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.isArchived, false),
        ilike(sql`${blocks.content} ->> 'text'`, pattern)
      )
    )
    .limit(20);

  // center the snippet on the matched term (Notion shows context around it),
  // not just the first 120 chars.
  const snippetByPage = new Map<string, string>();
  for (const hit of blockHits) {
    if (!snippetByPage.has(hit.pageId) && hit.text) {
      const text = hit.text;
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx < 0) {
        snippetByPage.set(hit.pageId, text.slice(0, 120));
      } else {
        const start = Math.max(0, idx - 40);
        snippetByPage.set(
          hit.pageId,
          (start > 0 ? "…" : "") + text.slice(start, start + 120)
        );
      }
    }
  }

  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      parentPageId: pages.parentPageId,
    })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.isArchived, false),
        editedCutoff ? sql`${pages.updatedAt} >= ${editedCutoff}` : sql`true`,
        fCreator === "me" ? eq(pages.createdBy, auth.user.id) : sql`true`,
        or(
          ilike(pages.title, pattern),
          snippetByPage.size > 0
            ? inArray(pages.id, [...snippetByPage.keys()])
            : sql`false`
        )
      )
    )
    .orderBy(sql`${pages.updatedAt} desc`) // most recently edited first (Notion)
    .limit(20);

  // breadcrumb context: the parent page's title under each result (Notion)
  const parentIds = [...new Set(rows.map((r) => r.parentPageId).filter(Boolean))] as string[];
  const parentTitle = new Map<string, string>();
  if (parentIds.length) {
    for (const p of await db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(inArray(pages.id, parentIds))) {
      parentTitle.set(p.id, p.title || "Untitled");
    }
  }

  let results: {
    id: string;
    title: string;
    icon: string | null;
    snippet: string | null;
    kind?: string;
    path?: string | null;
  }[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    snippet: snippetByPage.get(r.id) ?? null,
    kind: "page",
    path: r.parentPageId ? (parentTitle.get(r.parentPageId) ?? null) : null,
  }));

  // also cover the OKF file store (the primary content backend) by title, so a
  // Notion export's pages AND databases are findable in Quick Find.
  // OKF file nodes carry no edited/creator metadata — they only appear when
  // those filters are off.
  if (!editedCutoff && fCreator !== "me") {
    try {
      const ql = q.toLowerCase();
      // participant-only paths leak nothing, not even titles (relationship-doc privacy)
      const gate = await okfGateFor(auth.user.id);
      for (const p of listPages()) {
        if (!gate.canReadId(p.id)) continue;
        if (p.title.toLowerCase().includes(ql)) {
          results.push({ id: p.id, title: p.title, icon: p.icon, snippet: null, kind: p.kind });
        }
      }
    } catch {
      // OKF root missing/malformed → Postgres results only
    }
  }

  if (fType === "page") results = results.filter((r) => (r.kind ?? "page") === "page");
  else if (fType === "database") results = results.filter((r) => r.kind === "database");

  // rank title matches above content-snippet matches — an exact-title hit
  // must never sit below pages that merely mention the query in a block
  const ql2 = q.toLowerCase();
  const score = (r: { title: string | null }) => {
    const t = (r.title ?? "").toLowerCase();
    if (t === ql2) return 3;
    if (t.startsWith(ql2)) return 2;
    if (t.includes(ql2)) return 1;
    return 0;
  };
  results.sort((a, b) => score(b) - score(a));

  return NextResponse.json({ results });
}
