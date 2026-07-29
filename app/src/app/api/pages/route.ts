import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pageMembers, pages, agentRoomStates, chatRooms, users, workspaceMembers } from "@/lib/db/schema";
import { and, eq, inArray, max, isNotNull } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { scheduleMirror } from "@/lib/md-mirror";
import { listPages, okfSyntheticPage } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** GET /api/pages?archived=1 → { pages: Page[] } (flat list; tree is client-side).
 * OKF file-backed pages (the folder tree = the content backend) are merged in
 * so the ONE sidebar lists them alongside any Postgres pages. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) return NextResponse.json({ pages: [] });

  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.isArchived, archived)))
    .orderBy(pages.position);

 // Restricted pages (DM relationship docs etc.) show only to explicitly
 // granted members; owner/admin read everything for administration (same as
 // getPagePermission). Ordinary pages are unchanged. Guests get the 
 // inverse default: nothing but explicitly shared pages — being someone's DM
 // partner must not let you browse their workspace.
  let visible = rows;
  const role = await getWorkspaceRole(workspaceId, auth.user.id);
  if (role === "guest") {
    const ids = rows.map((r) => r.id);
    const grants = ids.length
      ? await db
          .select({ pageId: pageMembers.pageId })
          .from(pageMembers)
          .where(and(eq(pageMembers.userId, auth.user.id), inArray(pageMembers.pageId, ids)))
      : [];
    const granted = new Set(grants.map((g) => g.pageId));
    visible = rows.filter((r) => granted.has(r.id));
  } else {
    const restrictedIds = rows.filter((r) => r.restricted).map((r) => r.id);
    if (restrictedIds.length && role !== "owner" && role !== "admin") {
      const grants = await db
        .select({ pageId: pageMembers.pageId })
        .from(pageMembers)
        .where(
          and(eq(pageMembers.userId, auth.user.id), inArray(pageMembers.pageId, restrictedIds))
        );
      const granted = new Set(grants.map((g) => g.pageId));
      visible = rows.filter((r) => !r.restricted || granted.has(r.id));
    }
  }

  if (archived) return NextResponse.json({ pages: visible });

 // merge in the file-backed OKF pages (folder tree = the content backend).
 // participant-only OKF paths (relationship docs) are excluded for
 // non-members — the file tree has no permissions of its own, so the
 // okf_acl gate plays that role.
  let okf: (typeof rows)[number][] = [];
  try {
    const gate = await okfGateFor(auth.user.id);
    // Relationship docs live as files (workspace-agnostic), but each doc's
    // ROOM has a home workspace — surface a doc only in that workspace, so
    // e.g. Hannah's space doesn't list every other partner's doc. Docs whose
    // room we can't place keep the old everywhere-behavior.
    const docHomes = await db
      .select({ path: agentRoomStates.rootOkfPath, wsId: chatRooms.workspaceId })
      .from(agentRoomStates)
      .innerJoin(chatRooms, eq(chatRooms.id, agentRoomStates.roomId))
      .where(isNotNull(agentRoomStates.rootOkfPath));
    const homeByPrefix = docHomes.filter((d) => d.path) as { path: string; wsId: string }[];
    const memberRows = await db
      .select({ name: users.displayName })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    const memberNamesLower = new Set(
      memberRows.map((r) => (r.name ?? "").replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase())
    );
    const inThisWorkspace = (okfId: string) => {
      let rel: string;
      try {
        rel = Buffer.from(okfId, "base64url").toString("utf8");
      } catch {
        return true;
      }
      for (const d of homeByPrefix) {
        if (rel === d.path || rel.startsWith(d.path + "/")) return d.wsId === workspaceId;
      }
      // room mapping missing (resets can drop rooms): fall back to the
      // membership rule — a relationship doc belongs where its partner is a
      // member. Docs that don't parse as "… — <partner>" stay visible.
      const base = rel.split("/")[0];
      const m = base.match(/^(?:relationship doc|관계 문서)\s*—\s*(.+?)(?:-[0-9a-f]{6})?$/iu);
      if (!m) return true;
      const sides = m[1].split(/(?:❤️|❤|♥|💛|🧡|🩷|💘|💝)+/u).map((x) => x.trim()).filter(Boolean);
      const partner = sides[sides.length - 1];
      if (!partner) return true;
      const norm = (t: string) => t.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();
      return memberNamesLower.has(norm(partner));
    };
    okf = listPages()
      .filter((p) => gate.canReadId(p.id) && inThisWorkspace(p.id))
      .map((p) =>
      okfSyntheticPage({
        id: p.id,
        workspaceId,
        title: p.title,
        icon: p.icon,
        parentPageId: p.parentPageId,
        position: p.position,
        kind: p.kind,
      })
    );
  } catch {
 // OKF root missing/malformed → just the Postgres pages
  }
  return NextResponse.json({ pages: [...visible, ...okf] });
}

/** POST /api/pages { title?, parentPageId?, icon? } → { page } */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const { title = "", parentPageId = null, icon = null, teamspaceId = null } = body ?? {};

  const workspaceId = await getDefaultWorkspaceId(auth.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const [{ maxPos }] = await db
    .select({ maxPos: max(pages.position) })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        parentPageId ? eq(pages.parentPageId, parentPageId) : eq(pages.isArchived, false)
      )
    );

  const [page] = await db
    .insert(pages)
    .values({
      workspaceId,
      parentPageId,
      teamspaceId: typeof teamspaceId === "string" ? teamspaceId : null,
      title,
      icon,
      position: (maxPos ?? 0) + 1,
      createdBy: auth.user.id,
    })
    .returning();

 // Seed one empty paragraph server-side. If clients fabricated the first
 // block locally, two editors opening an empty page would each create their
 // own — duplicate blocks under concurrent editing.
  await db.insert(blocks).values({
    pageId: page.id,
    type: "paragraph",
    content: { text: "" },
    position: 1,
  });

  scheduleMirror(workspaceId);
  return NextResponse.json({ page }, { status: 201 });
}
