import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { pages, pageMembers, pageInvites, users, workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";
import { requirePagePermission } from "@/lib/auth/share-token";

export const dynamic = "force-dynamic";

const PERMISSIONS = ["view", "comment", "edit", "full"] as const;
type Permission = (typeof PERMISSIONS)[number];
function normalizePermission(value: unknown): Permission | null {
  return PERMISSIONS.includes(value as Permission) ? (value as Permission) : null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function assertAccess(pageId: string, userId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;
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
  return membership ? page : null;
}

/** GET → { members: [{ user: PublicUser, permission }] } */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [rows, invites] = await Promise.all([
    db
      .select({ user: users, permission: pageMembers.permission })
      .from(pageMembers)
      .innerJoin(users, eq(pageMembers.userId, users.id))
      .where(eq(pageMembers.pageId, pageId)),
    db.select().from(pageInvites).where(eq(pageInvites.pageId, pageId)),
  ]);

  return NextResponse.json({
    members: rows.map((r) => ({ user: toPublicUser(r.user), permission: r.permission })),
 // pending email invites (guests who have not accepted yet)
    invites: invites.map((i) => ({ email: i.email, permission: i.permission, pending: true })),
  });
}

/** POST { userId, permission? } → grant a specific person access to the page. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  const page = await assertAccess(pageId, auth.user.id);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

 // Managing page members requires full access
  const permCheck = await requirePagePermission(pageId, auth.user.id, "full");
  if (permCheck !== true) return permCheck;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
  const permission = normalizePermission(body?.permission) ?? "edit";

 // (a) invite by email — a specific person who may not be in the workspace yet.
 // Stored as a pending guest invite until they sign in with that email.
  if (email) {
    if (!EMAIL_RE.test(email))
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
 // If the email already resolves to a workspace member, grant directly.
    const [existing] = await db
      .select({ user: users })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, page.workspaceId),
          eq(users.ainAddress, email)
        )
      )
      .limit(1);
    if (existing) {
      await db
        .insert(pageMembers)
        .values({ pageId, userId: existing.user.id, permission })
        .onConflictDoUpdate({
          target: [pageMembers.pageId, pageMembers.userId],
          set: { permission },
        });
      return NextResponse.json(
        { member: { user: toPublicUser(existing.user), permission } },
        { status: 201 }
      );
    }
    await db
      .insert(pageInvites)
      .values({ pageId, email, permission, invitedBy: auth.user.id })
      .onConflictDoUpdate({
        target: [pageInvites.pageId, pageInvites.email],
        set: { permission },
      });
    return NextResponse.json(
      { invite: { email, permission, pending: true } },
      { status: 201 }
    );
  }

 // (b) invite an existing workspace member by id.
  if (!userId)
    return NextResponse.json({ error: "userId or email required" }, { status: 400 });

  const [target] = await db
    .select({ user: users })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, page.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  if (!target)
    return NextResponse.json({ error: "Not a workspace member" }, { status: 400 });

  await db
    .insert(pageMembers)
    .values({ pageId, userId, permission })
    .onConflictDoUpdate({
      target: [pageMembers.pageId, pageMembers.userId],
      set: { permission },
    });

  return NextResponse.json(
    { member: { user: toPublicUser(target.user), permission } },
    { status: 201 }
  );
}

/** DELETE ?userId= → revoke a person's page access. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { pageId } = await params;
  if (!(await assertAccess(pageId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

 // Managing page members requires full access
  const permCheck = await requirePagePermission(pageId, auth.user.id, "full");
  if (permCheck !== true) return permCheck;

  const userId = req.nextUrl.searchParams.get("userId");
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (userId) {
    await db
      .delete(pageMembers)
      .where(and(eq(pageMembers.pageId, pageId), eq(pageMembers.userId, userId)));
    return NextResponse.json({ ok: true });
  }
  if (email) {
    await db
      .delete(pageInvites)
      .where(and(eq(pageInvites.pageId, pageId), eq(pageInvites.email, email)));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "userId or email required" }, { status: 400 });
}
