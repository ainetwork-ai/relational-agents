import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiNotifPrefs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PREFS = { enabled: true, sound: true, dndUntil: null as Date | null };

/** GET /api/ai/notif-prefs → { enabled, sound, dndUntil } — defaults when absent. */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const [prefs] = await db
    .select()
    .from(aiNotifPrefs)
    .where(eq(aiNotifPrefs.userId, auth.user.id))
    .limit(1);

  if (!prefs) return NextResponse.json(DEFAULT_PREFS);
  return NextResponse.json({
    enabled: prefs.enabled,
    sound: prefs.sound,
    dndUntil: prefs.dndUntil,
  });
}

/** PATCH { enabled?, sound?, dndUntil? } → { enabled, sound, dndUntil } (upsert). */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof aiNotifPrefs.$inferInsert> = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.sound === "boolean") patch.sound = body.sound;
  if (typeof body?.dndUntil === "string" || body?.dndUntil === null) {
    patch.dndUntil = body.dndUntil ? new Date(body.dndUntil) : null;
  }

  const [updated] = await db
    .insert(aiNotifPrefs)
    .values({ userId: auth.user.id, ...DEFAULT_PREFS, ...patch })
    .onConflictDoUpdate({
      target: aiNotifPrefs.userId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({
    enabled: updated.enabled,
    sound: updated.sound,
    dndUntil: updated.dndUntil,
  });
}
