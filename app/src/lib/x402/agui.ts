/**
 * AG-UI (Agent–User Interaction protocol) events, the subset a payment run
 * emits. Shapes follow the AG-UI spec (`type` + payload, one JSON object per
 * SSE `data:` line) so any AG-UI client — CopilotKit, a chat surface, the
 * gift block here — can follow a payment as it happens.
 *
 * A gift payment is one run with four steps: quote → sign → settle → unlock.
 * State snapshots carry the x402 objects (requirements, receipt) so a client
 * can show exactly what the wire said.
 */

export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string; result?: unknown }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "STEP_STARTED"; stepName: PayStep }
  | { type: "STEP_FINISHED"; stepName: PayStep }
  | { type: "STATE_SNAPSHOT"; snapshot: PayState }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string };

export type PayStep = "quote" | "sign" | "settle" | "unlock";

export interface PayState {
  giftId: string;
  step: PayStep | "done" | "failed";
  settlement?: string;
  /** the 402's first accepted requirement */
  requirements?: unknown;
  /** who signed, once signed */
  payer?: string;
  receipt?: string;
  transaction?: string;
  error?: string;
  /** the stamped unlock, on the final snapshot */
  unlock?: unknown;
}

export type Emit = (e: AgUiEvent) => void;

/** One SSE frame. */
export function sseFrame(e: AgUiEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/** Runs `job`, turning its emitted events into an SSE Response. */
export function agUiStream(job: (emit: Emit) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (e) => controller.enqueue(enc.encode(sseFrame(e)));
      try {
        await job(emit);
      } catch (e) {
        emit({ type: "RUN_ERROR", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

/** A one-line assistant message, as the three AG-UI text events. */
export function say(emit: Emit, text: string): void {
  const messageId = `m_${Math.random().toString(36).slice(2, 10)}`;
  emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
  emit({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text });
  emit({ type: "TEXT_MESSAGE_END", messageId });
}
