import "server-only";
import { aiChatWithTools, type AiToolMessage } from "@/lib/ai";
import { A2UI_SURFACE_EVENT, eventId, type Emit } from "@/lib/agui/events";
import type { TreasurerTurn } from "./history";
import { stripA2uiMarkers } from "./surfaces";
import { TOOL_DEFS, runTreasurerTool, type TreasurerContext } from "./tools";

/**
 * One treasurer answer: the model and its tools in turns, bounded — at most
 * MAX_TOOL_ROUNDS rounds of tool calls, then one last turn with tools off, all
 * inside RUN_BUDGET_MS — and every step emitted as AG-UI events.
 *
 * A tool that throws gives the model a fixed "didn't work" result and the
 * server log a masked line; nothing raw reaches the stream. The tools that act
 * (propose, stop, buy) run at most once per answer, so a model repeating
 * itself can't queue or buy twice (recurring.ts refuses a second one anyway).
 */

export const MAX_TOOL_ROUNDS = 6;
export const RUN_BUDGET_MS = 90_000;
const CALL_TIMEOUT_MS = 45_000;
/** calls honoured per round; the rest are answered "not run" */
const MAX_CALLS_PER_ROUND = 4;
const ACTING_TOOLS = new Set(["propose_recurring_buy", "stop_recurring_buy", "buy_this_week"]);

export interface TreasurerAnswer {
  text: string;
  /** recurring-buy cards shown while answering, in order, deduplicated */
  cardActionIds: string[];
}

/** An error as one line for the server log, URLs masked (an upstream error can echo its endpoint). */
export function logLine(err: unknown): string {
  const e = err as { shortMessage?: unknown; message?: unknown; name?: unknown } | null;
  const text =
    typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : String(err);
  return `${typeof e?.name === "string" ? `${e.name}: ` : ""}${text.split("\n")[0].replace(/https?:\/\/\S+/g, "<url>").slice(0, 200)}`;
}

function say(emit: Emit, text: string): void {
  const messageId = eventId("msg");
  emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
  emit({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text });
  emit({ type: "TEXT_MESSAGE_END", messageId });
}

export async function runTreasurer(input: {
  ctx: TreasurerContext;
  system: string;
  history: TreasurerTurn[];
  question: string;
  emit: Emit;
  /** the client went away */
  signal: AbortSignal;
}): Promise<TreasurerAnswer> {
  const { ctx, emit } = input;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(RUN_BUDGET_MS)]);
  const messages: AiToolMessage[] = [
    { role: "system", content: input.system },
    ...input.history.map((h) => ({ role: h.role, content: stripA2uiMarkers(h.text) }) as AiToolMessage),
    { role: "user", content: input.question },
  ];
  const cards: string[] = [];
  const acted = new Set<string>();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const toolsOn = round < MAX_TOOL_ROUNDS;
    const stepName = `round-${round + 1}`;
    emit({ type: "STEP_STARTED", stepName });
    const turn = await aiChatWithTools(messages, TOOL_DEFS, {
      toolChoice: toolsOn ? "auto" : "none",
      reasoningEffort: "low",
      maxTokens: 4096,
      timeoutMs: CALL_TIMEOUT_MS,
      signal,
    });
    emit({ type: "STEP_FINISHED", stepName });

    if (!toolsOn || turn.toolCalls.length === 0) {
      const text =
        turn.content ??
        (turn.finishReason === "length"
          ? ctx.t("I ran out of room for that answer — ask me something narrower.")
          : ctx.t("I don't have an answer for that."));
      say(emit, text);
      return { text, cardActionIds: cards };
    }

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    });
    for (const [i, call] of turn.toolCalls.entries()) {
      emit({ type: "TOOL_CALL_START", toolCallId: call.id, toolCallName: call.name });
      emit({ type: "TOOL_CALL_ARGS", toolCallId: call.id, delta: call.arguments });
      emit({ type: "TOOL_CALL_END", toolCallId: call.id });

      let result: Record<string, unknown>;
      if (i >= MAX_CALLS_PER_ROUND) result = { ok: false, error: "not run: too many calls at once" };
      else if (ACTING_TOOLS.has(call.name) && acted.has(call.name))
        result = { ok: false, error: "already done once in this answer; not repeated" };
      else {
        if (ACTING_TOOLS.has(call.name)) acted.add(call.name);
        try {
          const outcome = await runTreasurerTool(call.name, call.arguments, ctx);
          result = outcome.result;
          if (outcome.surface) {
            emit({
              type: "CUSTOM",
              name: A2UI_SURFACE_EVENT,
              value: { toolCallId: call.id, actionId: outcome.cardActionId ?? null, messages: outcome.surface },
            });
          }
          if (outcome.cardActionId && !cards.includes(outcome.cardActionId)) cards.push(outcome.cardActionId);
        } catch (err) {
          console.error(`treasurer: tool ${call.name} failed:`, logLine(err));
          result = { ok: false, error: "that didn't work just now" };
        }
      }
      const content = JSON.stringify(result);
      emit({ type: "TOOL_CALL_RESULT", messageId: eventId("tool"), toolCallId: call.id, content, role: "tool" });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  // unreachable: the last round runs with tools off and always answers
  throw new Error("treasurer loop ended without an answer");
}
