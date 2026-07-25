import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aiChat, unfence } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** POST { prompt, context? } → { markdown } — Notion AI "draft with AI".
 *  The answer is plain markdown; the editor inserts it through the same
 *  pipeline as pasted markdown, so AI output becomes ordinary blocks. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const context = typeof body?.context === "string" ? body.context.slice(0, 4000) : "";
  if (!prompt) return NextResponse.json({ error: "Empty prompt" }, { status: 400 });

  try {
    const markdown = unfence(
      await aiChat(
        [
          {
            role: "system",
            content:
              "You are a writing assistant inside a Notion-style editor. " +
              "Answer ONLY with clean markdown for the document body (headings, lists, paragraphs, tables). " +
              "No preamble, no code fence around the whole answer, no title heading unless asked.",
          },
          {
            role: "user",
            content: context
              ? `Current page content for context:\n${context}\n\nTask: ${prompt}`
              : prompt,
          },
        ],
        { maxTokens: 1200 }
      )
    );
    return NextResponse.json({ markdown });
  } catch (err) {
    console.error("ai/write failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  }
}
