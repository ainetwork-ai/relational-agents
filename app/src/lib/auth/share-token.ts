import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pages, pageShares, pageMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getWorkspaceRole } from "@/lib/auth/workspace-role";

export type SharePermission = "view" | "comment" | "edit" | "full";

const PERMISSION_LEVEL: Record<SharePermission, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  full: 3,
};

export interface ShareAccess {
  pageId: string;
  permission: SharePermission;
}

/**
 * Validate a share token from the x-share-token header and check that
 * the requested pageId matches. Returns the access info or null.
 */
export async function validateShareToken(
  req: NextRequest,
  pageId: string
): Promise<ShareAccess | null> {
  const token = req.headers.get("x-share-token");
  if (!token) return null;

  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.token, token))
    .limit(1);
  if (!share) return null;

  // Token must match the requested page
  if (share.pageId !== pageId) return null;

  // Expired links are dead links
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return null;

  // Password-protected: the unlock cookie (set by /api/share/[token]/unlock)
  // must carry the current password hash
  if (share.passwordHash) {
    const cookie = req.cookies.get(`share_pw_${share.token}`)?.value;
    if (cookie !== share.passwordHash) return null;
  }

  // Verify the page still exists and is not archived
  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, share.pageId))
    .limit(1);
  if (!page || page.isArchived) return null;

  const perm = (share.permission ?? "view") as SharePermission;
  return { pageId: share.pageId, permission: perm };
}

/**
 * Check if a share permission level meets the required minimum.
 */
export function hasPermission(
  actual: SharePermission,
  required: SharePermission
): boolean {
  return PERMISSION_LEVEL[actual] >= PERMISSION_LEVEL[required];
}

/**
 * Return a 403 response for insufficient share permissions.
 */
export function forbiddenResponse(required: SharePermission) {
  return NextResponse.json(
    { error: `Requires at least '${required}' permission` },
    { status: 403 }
  );
}

/**
 * Get the effective permission level for a user on a specific page, or `null`
 * if the user has no access at all.
 *
 * Logic:
 *   1. If user has a pageMembers entry → use that permission level.
 *   2. No explicit grant: a regular workspace member (member/admin/owner) gets
 *      "full" (backwards compatible — the whole workspace can edit its pages).
 *   3. A *guest* (or a non-member) gets NO implicit access — a guest is scoped
 *      to exactly the pages explicitly shared with them (Notion guest rule).
 */
export async function getPagePermission(
  pageId: string,
  userId: string
): Promise<SharePermission | null> {
  const [page] = await db
    .select({ workspaceId: pages.workspaceId, restricted: pages.restricted })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!page) return null;

  const role = await getWorkspaceRole(page.workspaceId, userId);
  // Workspace owners/admins can always manage any page — an explicit page-level
  // share (even one that downgrades them) never locks them out.
  if (role === "owner" || role === "admin") return "full";

  // Explicit page grant: members can be narrowed, guests are scoped to it.
  const [member] = await db
    .select({ permission: pageMembers.permission })
    .from(pageMembers)
    .where(and(eq(pageMembers.pageId, pageId), eq(pageMembers.userId, userId)))
    .limit(1);
  if (member) {
    const perm = member.permission as SharePermission;
    return PERMISSION_LEVEL[perm] !== undefined ? perm : "full";
  }

  // No explicit grant: guests/non-members get none.
  if (!role || role === "guest") return null;
  // Restricted pages (e.g. DM 관계 문서) default-DENY plain members without a
  // grant — the whole point is participant-only privacy. Non-restricted pages
  // keep the workspace-wide default (backwards compatible).
  if (page.restricted) return null;
  return "full";
}

/**
 * Check if a user has at least the required permission on a page.
 * Returns true (allowed) or a 403 Response (denied).
 */
export async function requirePagePermission(
  pageId: string,
  userId: string,
  required: SharePermission
): Promise<true | NextResponse> {
  const actual = await getPagePermission(pageId, userId);
  if (actual && hasPermission(actual, required)) return true;
  return forbiddenResponse(required);
}
