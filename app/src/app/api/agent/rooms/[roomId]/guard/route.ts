import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { checkDraft } from "@/lib/agent/guard";

export const dynamic = "force-dynamic";

const MAX_DRAFT = 4_000;

/**
 * POST /api/agent/rooms/{roomId}/guard { draft } → GuardResult
 *
 * Pre-send fact check. Stateless — the client calls it on a typing debounce
 * (700ms–1s). `checked:false` means "no memory to consult" = show no badge.
 * Even on decline, force-sending is the client's call (the human decides).
 * Both agent rooms and DM rooms are allowed (requireRoomAccess handles both).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = await req.json().catch(() => ({}));
  const draft = typeof body?.draft === "string" ? body.draft : "";
  if (draft.length > MAX_DRAFT)
    return NextResponse.json({ error: `Draft too long (max ${MAX_DRAFT})` }, { status: 400 });

  try {
    return NextResponse.json(await checkDraft(roomId, draft));
  } catch (err) {
    // a guard outage must not block sending — answer allow (reason goes to the log)
    console.error("guard route failed:", err);
    return NextResponse.json({ verdict: "allow", checked: false });
  }
}
