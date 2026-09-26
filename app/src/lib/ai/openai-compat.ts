import type { AiMessage, AiTool, AiToolCall, AiToolMessage, ChatOptions, ToolChatOptions, ToolChatProvider, ToolChatResult } from "./types";

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
}): ToolChatProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
  };
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

    // Its own request shape, not chat()'s: reasoning deployments (Azure gpt-5.x)
    // reject `max_tokens` and any non-default `temperature`, so the budget goes as
    // `max_completion_tokens` and temperature only when the caller sets one.
    async chatWithTools(messages: AiToolMessage[], tools: AiTool[], o: ToolChatOptions): Promise<ToolChatResult> {
      const timeout = AbortSignal.timeout(o.timeoutMs ?? 60_000);
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: opts.model,
          messages,
          ...(tools.length ? { tools, tool_choice: o.toolChoice ?? "auto" } : {}),
          max_completion_tokens: o.maxTokens ?? 4096,
          ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
          ...(o.reasoningEffort ? { reasoning_effort: o.reasoningEffort } : {}),
        }),
        signal: o.signal ? AbortSignal.any([timeout, o.signal]) : timeout,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`AI upstream ${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: {
          finish_reason?: string | null;
          message?: {
            content?: string | null;
            tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      const choice = data.choices?.[0];
      if (!choice?.message) throw new Error("AI upstream returned no message");
      const toolCalls: AiToolCall[] = (choice.message.tool_calls ?? [])
        .filter((c) => typeof c.function?.name === "string")
        .map((c, i) => ({
          id: c.id || `call_${i}`,
          name: c.function!.name!,
          arguments: typeof c.function?.arguments === "string" ? c.function.arguments : "{}",
        }));
      const content = typeof choice.message.content === "string" ? choice.message.content.trim() || null : null;
      return { content, toolCalls, finishReason: choice.finish_reason ?? null };
    },
  };
}
