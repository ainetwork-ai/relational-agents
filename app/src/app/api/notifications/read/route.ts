import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** POST { id? } → mark one (id) or all of the caller's notifications read.
 * Returns the caller's remaining unread count. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const raw = await req.json().catch(() => ({}));
  const id = typeof raw?.id === "string" ? raw.id : null;

  const scope = id
    ? and(eq(notifications.userId, auth.user.id), eq(notifications.id, id))
    : eq(notifications.userId, auth.user.id);

  await db.update(notifications).set({ read: true }).where(scope);

  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.user.id), eq(notifications.read, false)));

  return NextResponse.json({ ok: true, unreadCount: value });
}
