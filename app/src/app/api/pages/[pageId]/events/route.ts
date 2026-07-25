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

  // 실시간 버스는 페이지·DB·DM 인박스가 하나의 문자열 키스페이스를 공유한다.
  // 페이지 이벤트 키(uuid)·OKF id(base64url)는 콜론을 담지 않지만 DM 인박스 키는
  // `dm-inbox:<userId>` 라 콜론을 포함한다 → 콜론이 있는 키 구독을 거절해, 남의
  // DM 인박스를 이 라우트로 도청하는 것을 원천 차단한다.
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
