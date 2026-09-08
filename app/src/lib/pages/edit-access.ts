import "server-only";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, workspaceMembers } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/middleware";
import { getPagePermission, requirePagePermission, validateShareToken, hasPermission } from "@/lib/auth/share-token";
import { isOkfId } from "@/lib/okf-store";
import { okfGateFor } from "@/lib/okf-acl";

/**
 * Who may EDIT this page through this request — the same answer the blocks
 * route gives, lifted out so the transactions route (save protocol stage 1)
 * cannot drift from it. Session first, share token second.
 */
export type EditAccess =
  | { ok: true; userId: string | null; workspaceId: string | null }
  | { ok: false; status: 404 | 403; error: string };

export async function resolveEditAccess(req: NextRequest, pageId: string): Promise<EditAccess> {
  const auth = await requireAuth();
  if (!("error" in auth)) {
    if (isOkfId(pageId)) {
      const gate = await okfGateFor(auth.user.id);
      if (!gate.canReadId(pageId)) return { ok: false, status: 404, error: "Not found" };
      return { ok: true, userId: auth.user.id, workspaceId: null };
    }
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (page) {
      const [membership] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, page.workspaceId), eq(workspaceMembers.userId, auth.user.id)))
        .limit(1);
      const member = !!membership && (!page.restricted || !!(await getPagePermission(pageId, auth.user.id)));
      if (member) {
        const check = await requirePagePermission(pageId, auth.user.id, "edit");
        if (check !== true) return { ok: false, status: 403, error: "Forbidden" };
        return { ok: true, userId: auth.user.id, workspaceId: page.workspaceId };
      }
    }
  }
  const share = await validateShareToken(req, pageId);
  if (share) {
    if (!hasPermission(share.permission, "edit")) return { ok: false, status: 403, error: "Forbidden" };
    const [page] = await db.select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, pageId)).limit(1);
    return { ok: true, userId: null, workspaceId: page?.workspaceId ?? null };
  }
  return { ok: false, status: 404, error: "Not found" };
}
