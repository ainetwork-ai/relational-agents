import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { subscribe } from "@/lib/realtime";
import { ensureFsWatcher } from "@/lib/fs-watch";
import { db } from "@/lib/db";
import { pages, pageShares } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Validate a share token (from query param, since EventSource can't set headers).
 */
async function validateToken(token: string, pageId: string): Promise<boolean> {
  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.token, token))
    .limit(1);
  if (!share || share.pageId !== pageId) return false;
  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, share.pageId))
    .limit(1);
  return !!page && !page.isArchived;
}

/**
 * GET /api/pages/:pageId/events — SSE stream of page mutations.
 * Events: data: {"type":"blocks"|"page","pageId","clientId","at"}
 * Heartbeat comment every 25s keeps proxies from closing the stream.
 *
 * Accepts session auth OR a share token (?token= query param, since
 * EventSource cannot set custom headers).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;

 // The realtime bus shares one string keyspace across pages, DBs, and DM
 // inboxes. Page keys (uuid) and OKF ids (base64url) never contain a colon;
 // DM inbox keys (`dm-inbox:<userId>`) do → refusing colon keys here makes
 // eavesdropping on someone's DM inbox via this route structurally impossible.
  if (pageId.includes(":")) return new Response("Not found", { status: 404 });

  ensureFsWatcher(); // disk edits must sync live too — the folder is the backend

 // Try session auth first
  let authorized = false;
  const auth = await requireAuth();
  if (!("error" in auth)) {
    authorized = true;
  }

 // Fallback: share-token from query param (EventSource can't set headers)
  if (!authorized) {
    const token = new URL(req.url).searchParams.get("token");
    if (token) {
      authorized = await validateToken(token, pageId);
    }
  }

  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line));
        } catch {}
      };

      send(`event: hello\ndata: {"pageId":"${pageId}"}\n\n`);

      const unsubscribe = subscribe(pageId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => send(`: hb\n\n`), 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
