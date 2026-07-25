import type { AiMessage, ChatOptions, ChatProvider } from "./types";

/**
 * Talks to any OpenAI-compatible /chat/completions endpoint over plain fetch —
 * currently the host's vLLM server (gemma-4-31B-it on :8100), which also reads
 * images. No SDK: the request is three fields and the response is one string,
 * so a dependency would not earn its keep here.
 */
export function openAiCompatProvider(opts: {
  baseUrl: string;
  model: string;
  /** sent as `Authorization: Bearer` when present (hosted gateways need it) */
  apiKey?: string;
}): ChatProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  return {
    name: `openai-compat(${opts.model})`,
    async chat(messages: AiMessage[], o: ChatOptions): Promise<string> {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          max_tokens: o.maxTokens ?? 1024,
          temperature: o.temperature ?? 0.4,
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
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
    },
  };
}
