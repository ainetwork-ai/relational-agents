import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { blocks, pages, workspaceMembers } from "@/lib/db/schema";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { aiChat } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** POST { question } → { answer, sources: [{id,title}] } — Notion AI Q&A.
 *  Retrieval = the same title/body match the search modal uses (top pages),
 *  then gemma answers strictly from that context. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Empty question" }, { status: 400 });

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, auth.user.id))
    .limit(1);
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  // retrieval: pages whose title or body mentions any significant query word
  const words = question
    .replace(/[?!.,]/g, " ")
    .split(/\s+/)
    .filter((w: string) => w.length >= 2)
    .slice(0, 6);
  const patterns: string[] = words.length ? words.map((w: string) => `%${w}%`) : [`%${question}%`];
  const hits = await db
    .selectDistinct({ id: pages.id, title: pages.title })
    .from(pages)
    .leftJoin(blocks, eq(blocks.pageId, pages.id))
    .where(
      and(
        eq(pages.workspaceId, membership.workspaceId),
        eq(pages.isArchived, false),
        or(
          ...patterns.flatMap((p: string) => [
            ilike(pages.title, p),
            ilike(sql`${blocks.content} ->> 'text'`, p),
          ])
        )
      )
    )
    .limit(5);

  const sources: { id: string; title: string; body: string }[] = [];
  for (const h of hits) {
    const rows = await db
      .select({ text: sql<string>`${blocks.content} ->> 'text'` })
      .from(blocks)
      .where(eq(blocks.pageId, h.id))
      .orderBy(blocks.position)
      .limit(60);
    sources.push({
      id: h.id,
      title: h.title || "Untitled",
      body: rows.map((r) => r.text).filter(Boolean).join("\n").slice(0, 3000),
    });
  }

  try {
    const context = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.body}`)
      .join("\n\n---\n\n");
    const answer = await aiChat(
      [
        {
          role: "system",
          content:
            "You answer questions about the user's workspace. Use ONLY the provided page excerpts. " +
            "Answer concisely in the question's language. If the answer is not in the excerpts, say you could not find it.",
        },
        {
          role: "user",
          content: `Pages:\n\n${context || "(no matching pages)"}\n\nQuestion: ${question}`,
        },
      ],
      { maxTokens: 600, temperature: 0.2 }
    );
    return NextResponse.json({
      answer,
      sources: sources.map(({ id, title }) => ({ id, title })),
    });
  } catch (err) {
    console.error("ai/qa failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  }
}
