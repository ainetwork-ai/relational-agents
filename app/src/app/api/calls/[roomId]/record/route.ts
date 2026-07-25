import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { db } from "@/lib/db";
import { agentRoomStates, callUtterances } from "@/lib/db/schema";
import { okfDocTreeFromState, okfDocPageId } from "@/lib/agent/okf-docs";
import { SECTIONS } from "@/lib/agent/parse-edits";
import { encodeId, nodeExists, readNode } from "@/lib/okf-store";
import { CHAT_ROUTE_PREFIX } from "@/lib/agent/pipeline";

export const dynamic = "force-dynamic";

/**
 * GET /api/calls/{roomId}/record?callId=… → what this call left in the record.
 *
 * The chat bubble is where a call is visible; the meaning of the call lives in
 * the relationship document. This is the link between them, so a bubble is not
 * a dead end.
 *
 * What it does NOT return is the transcript. Utterances feed the agent, not
 * the chat (CONTRACT 47e5bc5): the two of them see what they typed, and speaker
 * attribution assumes utterer = session user, so surfacing raw lines would put
 * every mis-attribution on screen. Only the count goes out, as evidence that
 * the agent was listening.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const callId = new URL(req.url).searchParams.get("callId") ?? "";
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const spoken = await db
    .select({ id: callUtterances.id })
    .from(callUtterances)
    .where(and(eq(callUtterances.roomId, roomId), eq(callUtterances.callId, callId)));

  const [state] = await db
    .select()
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  const tree = okfDocTreeFromState(state);

  // The recap writes `Sources: /dm/{roomId}#call-{callId}` under everything it
  // files, which makes the anchor the join key — no second table to keep in
  // sync, and an entry a member later edited or moved is found by its own text.
  const anchor = `${CHAT_ROUTE_PREFIX}/${roomId}#call-${callId}`;
  const entries: { section: string; sectionTitle: string; text: string; pageId: string }[] = [];

  if (tree) {
    for (const s of SECTIONS) {
      const rel = tree.sectionPaths[s.key];
      if (!rel || !nodeExists(rel)) continue;
      const node = readNode(rel);
      if (!node || node.kind !== "page") continue;
      // a Sources paragraph belongs to the block(s) above it, up to the
      // previous Sources line — that run is what this call wrote
      let pending: string[] = [];
      for (const b of node.blocks) {
        const text = ((b.content ?? {}) as { text?: string }).text ?? "";
        if (/^Sources:/i.test(text.trim())) {
          if (text.includes(anchor))
            for (const t of pending)
              entries.push({ section: s.key, sectionTitle: s.title, text: t, pageId: encodeId(rel) });
          pending = [];
          continue;
        }
        if (text.trim()) pending.push(text.trim());
      }
    }
  }

  return NextResponse.json({
    callId,
    utteranceCount: spoken.length,
    entries,
    docPageId: tree ? okfDocPageId(tree.rootPath) : null,
  });
}
