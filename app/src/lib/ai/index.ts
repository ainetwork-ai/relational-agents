import "server-only";
import { openAiCompatProvider } from "./openai-compat";
import type { AiMessage, ChatOptions, ChatProvider } from "./types";

export type { AiContentPart, AiMessage, ChatOptions, ChatProvider } from "./types";

/**
 * Local LLM bridge (scienario 44 — the workspace AI). Talks to the host's vLLM
 * OpenAI-compatible server (docker `vllm-gemma4`, gemma-4-31B-it on :8100).
 * Override with AI_URL / AI_MODEL env vars.
 *
 * Callers only ever see `aiChat`. To move to an SDK, add a module exporting a
 * `ChatProvider` and return it from `selectProvider` — nothing else changes.
 */
function selectProvider(): ChatProvider {
  return openAiCompatProvider({
    baseUrl: process.env.AI_URL ?? "http://localhost:8100/v1",
    model: process.env.AI_MODEL ?? "gemma-4-31B-it",
    apiKey: process.env.AI_API_KEY,
  });
}

// Built once per server process; env is fixed for its lifetime.
let provider: ChatProvider | null = null;
export function aiProvider(): ChatProvider {
  return (provider ??= selectProvider());
}

export async function aiChat(messages: AiMessage[], opts: ChatOptions = {}): Promise<string> {
  return aiProvider().chat(messages, opts);
}

/** Strip a ```md fence if the model wrapped its whole answer in one. */
export function unfence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s;
}
