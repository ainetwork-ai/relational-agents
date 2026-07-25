import { requireAuth } from "@/lib/auth/middleware";
import { subscribe } from "@/lib/realtime";
import { dmInboxChannel } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/dm/events — 내 DM 인박스 SSE 스트림.
 * 채널 키는 세션에서 유도(dm-inbox:<userId>)하므로 남의 인박스는 구독 불가.
 * 이벤트: data: {"type":"dm-message"|"dm-room"|"dm-typing","roomId","clientId","at",("user")}
 * — 메시지 본문은 싣지 않는다(알림 전용); 수신자는 refetch. 25초 하트비트.
 */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return new Response("Unauthorized", { status: 401 });
  const channel = dmInboxChannel(auth.user.id);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line));
        } catch {}
      };

      send(`event: hello\ndata: {}\n\n`);

      const unsubscribe = subscribe(channel, (event) => {
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
