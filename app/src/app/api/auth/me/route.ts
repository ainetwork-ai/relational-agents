import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/** PATCH { displayName?, avatarUrl? } → { user }. avatarUrl must be an
 * /uploads/* path (from POST /api/upload) or "" to clear the photo. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: { displayName?: string; avatarUrl?: string | null } = {};

  if (typeof body?.displayName === "string") {
    const name = body.displayName.trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    patch.displayName = name;
  }
  if (typeof body?.avatarUrl === "string") {
    if (body.avatarUrl !== "" && !/^\/uploads\/[\w.-]+$/.test(body.avatarUrl))
      return NextResponse.json({ error: "avatarUrl must be an /uploads/ path" }, { status: 400 });
    patch.avatarUrl = body.avatarUrl === "" ? null : body.avatarUrl;
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [user] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, session.userId))
    .returning();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user: toPublicUser(user) });
}

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return NextResponse.json({ user: user ? toPublicUser(user) : null });
}
