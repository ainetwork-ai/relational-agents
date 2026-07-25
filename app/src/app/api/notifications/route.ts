import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { notifications, pages, users } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { toPublicUser } from "@/lib/auth/public-user";

export const dynamic = "force-dynamic";

/** GET → { notifications: [...], unreadCount } for the caller, newest first.
 *  Each row carries its actor (PublicUser | null) and the target page title. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const rows = await db
    .select({ n: notifications, actor: users, pageTitle: pages.title })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    // pageId is text (it can hold OKF ids); cast the uuid side for the join
    .leftJoin(pages, sql`${notifications.pageId} = ${pages.id}::text`)
    .where(eq(notifications.userId, auth.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  const result = rows.map((r) => ({
    ...r.n,
    actor: r.actor ? toPublicUser(r.actor) : null,
    pageTitle: r.pageTitle ?? null,
  }));
  const unreadCount = result.filter((r) => !r.read).length;

  return NextResponse.json({ notifications: result, unreadCount });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST { type: "reminder", body, pageId? } → a self-reminder in the caller's
 *  inbox (Notion's date reminders / agent nudges). An identical UNREAD reminder
 *  (same page + body) is not duplicated, so periodic feeders can re-post. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const payload = await req.json().catch(() => ({}));
  if (payload?.type !== "reminder") {
    return NextResponse.json({ error: "unsupported type" }, { status: 400 });
  }
  const body = String(payload?.body ?? "").slice(0, 500);
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });
  const pageId = typeof payload?.pageId === "string" && UUID_RE.test(payload.pageId) ? payload.pageId : null;

  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, auth.user.id),
        eq(notifications.type, "reminder"),
        eq(notifications.body, body),
        eq(notifications.read, false),
        ...(pageId ? [eq(notifications.pageId, pageId)] : [])
      )
    )
    .limit(1);
  if (existing) return NextResponse.json({ notification: existing, deduped: true });

  const [notification] = await db
    .insert(notifications)
    .values({ userId: auth.user.id, type: "reminder", pageId, body })
    .returning();
  return NextResponse.json({ notification }, { status: 201 });
}
