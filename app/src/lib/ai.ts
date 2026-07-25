import "server-only";

/**
 * Local LLM bridge (scienario 44 — Notion AI). Talks to the host's vLLM
 * OpenAI-compatible server (docker `vllm-gemma4`, gemma-4-31B-it on :8100).
 * Override with AI_URL / AI_MODEL env vars.
 */

const AI_URL = process.env.AI_URL ?? "http://localhost:8100/v1";
const AI_MODEL = process.env.AI_MODEL ?? "gemma-4-31B-it";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function aiChat(
  messages: AiMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const res = await fetch(`${AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI upstream ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const out = data.choices?.[0]?.message?.content;
  if (typeof out !== "string") throw new Error("AI upstream returned no content");
  return out.trim();
}

/** Strip a ```md fence if the model wrapped its whole answer in one. */
export function unfence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s;
}
