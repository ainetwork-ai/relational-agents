import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pageMembers, pages } from "@/lib/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";
import { scheduleMirror } from "@/lib/md-mirror";
import { listPages, okfSyntheticPage } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

/** GET /api/pages?archived=1 → { pages: Page[] } (flat list; tree is client-side).
 *  OKF file-backed pages (the folder tree = the content backend) are merged in
 *  so the ONE sidebar lists them alongside any Postgres pages. */
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

  // 접근 제한 페이지(DM 관계 문서 등)는 명시 권한 있는 멤버에게만 노출.
  // owner/admin은 관리상 전체 열람(getPagePermission과 동일). 기본 페이지는 그대로.
  let visible = rows;
  const restrictedIds = rows.filter((r) => r.restricted).map((r) => r.id);
  if (restrictedIds.length) {
    const role = await getWorkspaceRole(workspaceId, auth.user.id);
    if (role !== "owner" && role !== "admin") {
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
  // 참여자 전용 OKF 경로(관계 문서)는 멤버가 아니면 제외 — 파일 트리에는
  // 권한 개념이 없으므로 okf_acl 게이트가 그 역할을 한다.
  let okf: (typeof rows)[number][] = [];
  try {
    const gate = await okfGateFor(auth.user.id);
    okf = listPages()
      .filter((p) => gate.canReadId(p.id))
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
  // own — duplicate blocks under concurrent editing (found by S114).
  await db.insert(blocks).values({
    pageId: page.id,
    type: "paragraph",
    content: { text: "" },
    position: 1,
  });

  scheduleMirror(workspaceId);
  return NextResponse.json({ page }, { status: 201 });
}
