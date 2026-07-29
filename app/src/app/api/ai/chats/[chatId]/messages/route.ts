import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { aiChats, aiChatMessages, aiUsage } from "@/lib/db/schema";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { streamReply, deriveTitle } from "@/lib/ai-chat";
import type { AiMessage } from "@/lib/ai";
import { getOrCreateUsage, isOverLimit } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TEXT = 20_000;
// default page size for long-chat "load earlier messages" — generous so ordinary tests (a few messages) are unaffected.
const DEFAULT_MESSAGES_LIMIT = 50;

// the e2e failOnce hook's "fail once" state (consumed per chat). Server memory — demo/e2e only.
const failedOnceChats = new Set<string>();

// fixed sources for e2e/demo: lets tests deterministically check that the
// citation (sources) UI appears on forceFake replies. Ids are dummies —
// navigation to real pages isn't verified here.
const FAKE_SOURCES = [
  { id: "demo-page-1", title: "Project overview" },
  { id: "demo-page-2", title: "Meeting notes 2026-07" },
];

// B. e2e determinism hook: distinguishable streaming error states
// (ratelimit/server). Separate from failOnce — no "once" semantics; while the
// condition is set, every request errors immediately.
const E2E_ERROR_MESSAGES: Record<"ratelimit" | "server", string> = {
  ratelimit: "Too many requests. Please try again shortly.",
  server: "Server error (5xx)",
};

async function loadChat(chatId: string, userId: string) {
  const [chat] = await db
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.id, chatId), eq(aiChats.userId, userId)))
    .limit(1);
  return chat ?? null;
}

/**
 * GET → { messages, hasMore }. Paginates via `?limit` (default 50) and
 * `?before` (createdAt cursor): fetch limit messages older than before,
 * newest-first, then reverse into chronological order.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  if (!(await loadChat(chatId, auth.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_MESSAGES_LIMIT;
  const before = searchParams.get("before");
  const beforeDate = before ? new Date(before) : null;

  const conditions = [eq(aiChatMessages.chatId, chatId)];
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) {
    conditions.push(lt(aiChatMessages.createdAt, beforeDate));
  }

  const page = await db
    .select()
    .from(aiChatMessages)
    .where(and(...conditions))
    .orderBy(desc(aiChatMessages.createdAt))
    .limit(limit + 1);
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();

  return NextResponse.json({ messages, hasMore });
}

/**
 * POST { text, present? } → SSE stream.
 * Events: `delta` (partial text), `done` ({messageId, sources}), `error`.
 * Stores the user message, streams the assistant reply token by token, then
 * stores it. Without `present` (background send), completion sets hasUnread=true.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { chatId } = await ctx.params;
  const chat = await loadChat(chatId, auth.user.id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const regenerate = body?.regenerate === true;
  let text = typeof body?.text === "string" ? body.text.trim() : "";
  const present = body?.present === true;
 // e2e determinism hook: the e2e_fake_ai cookie/flag forces fake replies.
 // Never active in real deployments — allowed only in dev or on servers with
 // an explicit AI_E2E_HOOK=1 (set when running e2e against an isolated prod
 // server).
  const e2eHookAllowed =
    process.env.NODE_ENV !== "production" || process.env.AI_E2E_HOOK === "1";
  const forceFake =
    e2eHookAllowed &&
    (body?.fake === true || req.cookies.get("e2e_fake_ai")?.value === "1");
 // failOnce hook: forceFake (e2e) only — force-fails the first attempt with
 // an error event so the retry UI (chat-retry-btn) tests deterministically.
 // No message is stored. body.failOnce === false is the explicit "don't fail
 // this one" override (the retry path).
  const failRequested =
    forceFake &&
    body?.failOnce !== false &&
    (body?.failOnce === true || req.cookies.get("e2e_fail_next")?.value === "1");
 // genuinely "once": fail only the first attempt per chat, then consume →
 // the retry (chat-retry-btn) succeeds even with the cookie still set
 // (deterministic retry-UI verification).
  const failOnce = failRequested && !failedOnceChats.has(chatId);
  if (failRequested) {
    if (failOnce) failedOnceChats.add(chatId);
    else failedOnceChats.delete(chatId); // clear so it can re-arm after consumption
  }
 // forces a distinguishable error kind via the e2e_error cookie /
 // body.errorKind. Independent of failOnce — never consumed; fires on every
 // forceFake request while the condition is set.
  const requestedErrorKind: "ratelimit" | "server" | null =
    req.cookies.get("e2e_error")?.value === "ratelimit"
      ? "ratelimit"
      : req.cookies.get("e2e_error")?.value === "server"
        ? "server"
        : body?.errorKind === "ratelimit"
          ? "ratelimit"
          : body?.errorKind === "server"
            ? "server"
            : null;
  const errorKind = forceFake ? requestedErrorKind : null;
 // load history (before storing the current message)
  let prior = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.chatId, chatId))
    .orderBy(asc(aiChatMessages.createdAt));

  if (regenerate) {
 // regenerate: without adding a new user message, delete the last
 // assistant reply and answer the last user message again as the prompt.
    const last = prior[prior.length - 1];
    if (last?.role === "assistant") {
      await db.delete(aiChatMessages).where(eq(aiChatMessages.id, last.id));
      prior = prior.slice(0, -1);
    }
    const lastUser = [...prior].reverse().find((m) => m.role === "user");
    if (!lastUser) return NextResponse.json({ error: "Nothing to regenerate" }, { status: 400 });
    text = lastUser.content;
  }

  if (!text) return NextResponse.json({ error: "Empty text" }, { status: 400 });
  if (text.length > MAX_TEXT)
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT})` }, { status: 400 });

  const encoder = new TextEncoder();
  const send = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (failOnce) {
 // stream only the error event and finish — nothing is stored.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(send("error", { message: "A temporary error occurred (e2e failOnce)" }));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  if (errorKind) {
 // stream only the distinguishable error event and finish — nothing is stored.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(send("error", { kind: errorKind, message: E2E_ERROR_MESSAGES[errorKind] }));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  const isFirst = prior.length === 0;
  const history: AiMessage[] = regenerate
    ? prior.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) // minus the last user message (used as the prompt)
    : prior.map((m) => ({ role: m.role, content: m.content }));

  if (!regenerate) {
 // plan-gating mock: admin-off or an over-limit free plan blocks the send
 // and counts it. e2e deterministic sends (forceFake) are excluded from
 // gating/counting so they don't pile up in the shared demo workspace and
 // block other tests (gating-UI tests set state directly via PATCH).
    if (!forceFake) {
      const usage = await getOrCreateUsage(chat.workspaceId);
      if (usage.aiDisabledByAdmin)
        return NextResponse.json({ error: "AI has been disabled by an administrator" }, { status: 403 });
      if (isOverLimit(usage))
        return NextResponse.json({ error: "You have reached this month's usage limit" }, { status: 403 });
      await db
        .update(aiUsage)
        .set({ messageCount: usage.messageCount + 1, updatedAt: new Date() })
        .where(eq(aiUsage.workspaceId, chat.workspaceId));
    }

 // store the user message; first message auto-titles the chat
    await db.insert(aiChatMessages).values({ chatId, role: "user", content: text });
    if (isFirst && (chat.title === "New chat" || !chat.title.trim())) {
      await db.update(aiChats).set({ title: deriveTitle(text) }).where(eq(aiChats.id, chatId));
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        for await (const delta of streamReply(history, text, { forceFake })) {
          full += delta;
          controller.enqueue(send("delta", { delta }));
        }
        const [saved] = await db
          .insert(aiChatMessages)
          .values({
            chatId,
            role: "assistant",
            content: full,
            sources: forceFake ? FAKE_SOURCES : undefined,
          })
          .returning();
        await db
          .update(aiChats)
          .set({ updatedAt: new Date(), hasUnread: present ? false : true })
          .where(eq(aiChats.id, chatId));
        controller.enqueue(send("done", { messageId: saved.id, sources: saved.sources ?? [] }));
      } catch (err) {
        controller.enqueue(
          send("error", { message: err instanceof Error ? err.message : String(err) })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
