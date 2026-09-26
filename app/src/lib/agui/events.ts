/**
 * AG-UI (Agent–User Interaction protocol) events for an agent run that talks,
 * calls tools and shows UI — the treasurer's stream (/api/treasury/[roomId]/ask).
 * Shapes follow the AG-UI spec: a `type` plus its payload, one JSON object
 * per SSE `data:` line. A2UI surfaces ride in CUSTOM events named
 * A2UI_SURFACE_EVENT, whose value is the surface's A2UI messages.
 *
 * The payment run's narrower subset lives in lib/x402/agui.ts (the gift
 * block reads it); this one is the general set. Pure, and safe to import from
 * the client for the types.
 */

export const A2UI_SURFACE_EVENT = "a2ui.surface";

export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string; result?: unknown }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "STEP_STARTED"; stepName: string }
  | { type: "STEP_FINISHED"; stepName: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; messageId: string; toolCallId: string; content: string; role: "tool" }
  | { type: "STATE_SNAPSHOT"; snapshot: unknown }
  | { type: "CUSTOM"; name: string; value: unknown };

export type AgUiEventType = AgUiEvent["type"];

export type Emit = (e: AgUiEvent) => void;

export function eventId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** One SSE frame. */
export function sseFrame(e: AgUiEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/**
 * Runs `job`, turning what it emits into an SSE Response. A throw becomes
 * RUN_ERROR with `failureMessage` — never the error's own text, which may
 * carry an upstream URL. `signal` fires when the client goes away, so the job
 * can stop spending on an answer nobody reads.
 */
export function agUiStream(
  job: (emit: Emit, signal: AbortSignal) => Promise<void>,
  opts: { failureMessage: string; onError?: (err: unknown) => void }
): Response {
  const enc = new TextEncoder();
  const gone = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (e) => {
        if (gone.signal.aborted) return;
        try {
          controller.enqueue(enc.encode(sseFrame(e)));
        } catch {
          // the reader left between the check and the write
        }
      };
      try {
        await job(emit, gone.signal);
      } catch (err) {
        opts.onError?.(err);
        emit({ type: "RUN_ERROR", message: opts.failureMessage });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a cancelled reader
        }
      }
    },
    cancel() {
      gone.abort();
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

/**
 * Reads AG-UI events out of an SSE byte stream (the client side of
 * agUiStream). Lines that are not a JSON `data:` frame are skipped.
 */
export async function readAgUiStream(body: ReadableStream<Uint8Array>, onEvent: (e: AgUiEvent) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as AgUiEvent);
      } catch {
        // a malformed frame is dropped, not fatal
      }
    }
  }
}
