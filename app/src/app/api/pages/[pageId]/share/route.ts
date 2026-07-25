import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, pageShares, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { isOkfId } from "@/lib/okf-store";
import { requirePagePermission } from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

const PERMISSIONS = ["view", "comment", "edit", "full"] as const;
type Permission = (typeof PERMISSIONS)[number];
function normalizePermission(value: unknown): Permission | null {
  return PERMISSIONS.includes(value as Permission) ? (value as Permission) : null;
}

async function assertAccess(pageId: string, userId: string) {
  if (isOkfId(pageId)) return false; // file-backed page: no SQL share link
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return false;
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return !!membership;
}

/** GET → { token: string | null, permission } */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.pageId, pageId))
    .limit(1);
  return NextResponse.json({
    token: share?.token ?? null,
    permission: share?.permission ?? "view",
    expiresAt: share?.expiresAt ?? null,
    hasPassword: !!share?.passwordHash,
    allowDuplicate: share?.allowDuplicate ?? true,
  });
}

/** POST → { token, permission } (creates the public link if missing) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Share management requires full access
  const permCheck = await requirePagePermission(pageId, auth.user.id, "full");
  if (permCheck !== true) return permCheck;

  const body = await req.json().catch(() => ({}));
  const permission = normalizePermission(body?.permission) ?? "view";

  const [existing] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.pageId, pageId))
    .limit(1);
  if (existing)
    return NextResponse.json({
      token: existing.token,
      permission: existing.permission,
    });

  const token = randomBytes(16).toString("hex");
  await db
    .insert(pageShares)
    .values({ pageId, token, permission, createdBy: auth.user.id });
  return NextResponse.json({ token, permission }, { status: 201 });
}

/** PATCH → { token, permission } (changes the access level of the link) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Share management requires full access
  const permCheck = await requirePagePermission(pageId, auth.user.id, "full");
  if (permCheck !== true) return permCheck;

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  const permission = normalizePermission(body?.permission);
  if (permission) update.permission = permission;
  if ("expiresAt" in body) {
    const v = body.expiresAt;
    if (v === null || v === "") update.expiresAt = null;
    else {
      const d = new Date(v);
      if (isNaN(d.getTime()))
        return NextResponse.json({ error: "Invalid expiry" }, { status: 400 });
      update.expiresAt = d;
    }
  }
  if ("password" in body) {
    const v = body.password;
    update.passwordHash =
      typeof v === "string" && v.length > 0
        ? createHash("sha256").update(v).digest("hex")
        : null;
  }
  if (typeof body?.allowDuplicate === "boolean") update.allowDuplicate = body.allowDuplicate;
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [updated] = await db
    .update(pageShares)
    .set(update)
    .where(eq(pageShares.pageId, pageId))
    .returning();
  if (!updated)
    return NextResponse.json({ error: "No share link" }, { status: 404 });
  return NextResponse.json({
    token: updated.token,
    permission: updated.permission,
    expiresAt: updated.expiresAt,
    hasPassword: !!updated.passwordHash,
    allowDuplicate: updated.allowDuplicate,
  });
}

/** DELETE → { ok: true } (revokes the public link) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Share management requires full access
  const permCheck = await requirePagePermission(pageId, auth.user.id, "full");
  if (permCheck !== true) return permCheck;

  await db.delete(pageShares).where(eq(pageShares.pageId, pageId));
  return NextResponse.json({ ok: true });
}
