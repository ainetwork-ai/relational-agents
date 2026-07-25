import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { blocks, pages, workspaceMembers, type Block } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { PageView } from "@/components/page/page-view";
import {
  isOkfId,
  decodeId,
  readNode,
  okfSyntheticPage,
  okfIcon,
  parsedToBlocks,
} from "@/lib/okf-store";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { okfGateFor } from "@/lib/okf-acl";

export const dynamic = "force-dynamic";

export default async function PageRoute({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const { pageId } = await params;

  // OKF (file-backed) content: the folder tree IS the backend. Everything
  // renders through the SAME PageView — a .md file is a page, a .csv file is a
  // page whose body is the single database view (a synthetic `database` block
  // that reads /api/databases/{id}, served from the CSV). No parallel view.
  if (isOkfId(pageId)) {
    // participant-only OKF paths (relationship docs) hide their existence from non-members
    const gate = await okfGateFor(session.userId);
    if (!gate.canReadId(pageId)) notFound();
    let node = null;
    try {
      node = readNode(decodeId(pageId));
    } catch {
      node = null;
    }
    if (!node) notFound();

    const workspaceId = (await getDefaultWorkspaceId(session.userId)) ?? "";
    const okfPage = okfSyntheticPage({
      id: pageId,
      workspaceId,
      title: node.title,
      icon: okfIcon(node.kind),
      parentPageId: null,
      position: 0,
    });

    if (node.kind === "database") {
      const now = new Date();
      const dbBlock: Block = {
        id: `okfdb-${pageId}`,
        pageId,
        type: "database",
        content: { databaseId: pageId, fullPage: true },
        parentBlockId: null,
        position: 1,
        createdAt: now,
        updatedAt: now,
      };
      return <PageView key={okfPage.id} initialPage={okfPage} initialBlocks={[dbBlock]} wide />;
    }

    // .md page or a database row (both render their file blocks in PageView)
    return (
      <PageView
        key={okfPage.id}
        initialPage={okfPage}
        initialBlocks={parsedToBlocks(node.blocks, pageId)}
      />
    );
  }

  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1)
    .catch(() => []); // malformed uuid → not found, not a 500

  if (!page || page.isArchived) notFound();

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, session.userId)
      )
    )
    .limit(1);
  if (!membership) notFound();

  const blockRows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(blocks.position);

  return <PageView key={page.id} initialPage={page} initialBlocks={blockRows} />;
}
