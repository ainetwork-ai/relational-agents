import { requireAuth } from "@/lib/auth/middleware";
import { subscribe } from "@/lib/realtime";
import { dmInboxChannel } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/dm/events — my DM inbox SSE stream.
 * The channel key derives from the session (dm-inbox:<userId>), so nobody can
 * subscribe to someone else's inbox.
 * Events: data: {"type":"dm-message"|"dm-room"|"dm-typing","roomId","clientId","at",("user")}
 * — no message bodies (notification-only); receivers refetch. 25s heartbeat.
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
