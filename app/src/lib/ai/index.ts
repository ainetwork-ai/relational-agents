import "server-only";
import { openAiCompatProvider } from "./openai-compat";
import type { AiMessage, AiTool, AiToolMessage, ChatOptions, ChatProvider, ToolChatOptions, ToolChatProvider, ToolChatResult } from "./types";

export type {
  AiContentPart,
  AiMessage,
  AiTool,
  AiToolCall,
  AiToolMessage,
  ChatOptions,
  ChatProvider,
  ToolChatOptions,
  ToolChatProvider,
  ToolChatResult,
} from "./types";

/**
 * Local LLM bridge (scienario 44 — the workspace AI). Talks to the host's vLLM
 * OpenAI-compatible server (docker `vllm-gemma4`, gemma-4-31B-it on :8100).
 * Override with AI_URL / AI_MODEL env vars.
 *
 * Callers only ever see `aiChat`. To move to an SDK, add a module exporting a
 * `ChatProvider` and return it from `selectProvider` — nothing else changes.
 */
function selectProvider(): ToolChatProvider {
  return openAiCompatProvider({
    baseUrl: process.env.AI_URL ?? "http://localhost:8100/v1",
    model: process.env.AI_MODEL ?? "gemma-4-31B-it",
    apiKey: process.env.AI_API_KEY,
    reasoning: process.env.AI_REASONING === "1",
  });
}

// Built once per server process; env is fixed for its lifetime.
let provider: ToolChatProvider | null = null;
export function aiProvider(): ChatProvider {
  return (provider ??= selectProvider());
}

export async function aiChat(messages: AiMessage[], opts: ChatOptions = {}): Promise<string> {
  return aiProvider().chat(messages, opts);
}

/**
 * Tool calls can go to their own endpoint: a chat server may not parse tool calls at all (vLLM
 * refuses `tools` without --enable-auto-tool-choice and a parser). AI_TOOLS_URL — with
 * AI_TOOLS_MODEL, AI_TOOLS_API_KEY and AI_TOOLS_REASONING, read like their AI_* twins — sends
 * only aiChatWithTools there; unset, tool calls use AI_URL like everything else.
 */
function selectToolProvider(): ToolChatProvider {
  if (!process.env.AI_TOOLS_URL) return (provider ??= selectProvider());
  return openAiCompatProvider({
    baseUrl: process.env.AI_TOOLS_URL,
    model: process.env.AI_TOOLS_MODEL ?? process.env.AI_MODEL ?? "gemma-4-31B-it",
    apiKey: process.env.AI_TOOLS_API_KEY,
    reasoning: process.env.AI_TOOLS_REASONING === "1",
  });
}
let toolProvider: ToolChatProvider | null = null;

/** One tool-calling turn: the model either answers (`content`) or asks for `toolCalls`. The caller runs them and loops. */
export async function aiChatWithTools(
  messages: AiToolMessage[],
  tools: AiTool[],
  opts: ToolChatOptions = {}
): Promise<ToolChatResult> {
  return (toolProvider ??= selectToolProvider()).chatWithTools(messages, tools, opts);
}

/** Strip a ```md fence if the model wrapped its whole answer in one. */
export function unfence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s;
}
