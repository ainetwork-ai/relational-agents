import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { aiChat } from "@/lib/ai";

export const dynamic = "force-dynamic";

const MAX_TEXT = 500;
/** A subtitle that arrives late is worse than none — give up early and let
 *  the caller drop it rather than stack translations behind a slow model. */
const TIMEOUT_MS = 8_000;

const TARGETS = {
  en: { name: "English", from: "Korean" },
  ko: { name: "Korean", from: "English" },
} as const;
type Target = keyof typeof TARGETS;

/**
 * POST { text, target: "en" | "ko" } → { text }
 *
 * Live subtitle translation for the SPEAKER'S OWN screen. Deliberately not
 * wired to anything else: the peer never sees this, the agent never reads it,
 * and nothing is stored. Room membership is required so the endpoint is not a
 * free translation service, but an active call is NOT required — the subtitle
 * must not blink out because call state and the client disagree for a beat.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const target: Target = body?.target === "ko" ? "ko" : "en";
  if (!text) return NextResponse.json({ error: "Empty text" }, { status: 400 });

  const { name, from } = TARGETS[target];
  try {
    const out = await aiChat(
      [
        {
          role: "system",
          content:
            `You translate one line of live conversation from ${from} into ${name}. ` +
            `Reply with the ${name} translation ONLY — no quotes, no notes, no ` +
            `romanization, no alternatives. Keep it spoken and natural, the length ` +
            `of the original. If the line is already ${name}, repeat it unchanged.`,
        },
        { role: "user", content: text },
      ],
      // low temperature: a subtitle should not improvise
      { maxTokens: 200, temperature: 0.2, timeoutMs: TIMEOUT_MS }
    );
    const clean = out.trim().replace(/^["“”']|["“”']$/g, "");
    if (!clean) return NextResponse.json({ error: "Empty translation" }, { status: 503 });
    return NextResponse.json({ text: clean });
  } catch {
    // the model is down or slow — the caller silently keeps the original
    return NextResponse.json({ error: "Translation unavailable" }, { status: 503 });
  }
}
