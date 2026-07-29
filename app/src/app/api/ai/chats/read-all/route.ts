import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/ai/chats/read-all → { ok } — hasUnread=false across all of the caller's chats. */
export async function POST() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  await db
    .update(aiChats)
    .set({ hasUnread: false })
    .where(and(eq(aiChats.userId, auth.user.id), eq(aiChats.hasUnread, true)));
  return NextResponse.json({ ok: true });
}
