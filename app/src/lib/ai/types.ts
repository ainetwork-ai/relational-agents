/**
 * The port every LLM caller in this app talks to.
 *
 * Nothing above this file knows how the model is reached — HTTP, an SDK, or a
 * stub in tests. Swapping to the Vercel AI SDK (or any other) means writing one
 * new module that satisfies `ChatProvider` and selecting it in ./index.ts; the
 * agent pipeline, guard, and route handlers stay untouched.
 */

/** Multimodal content part (OpenAI chat shape — what our providers speak). */
export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string | AiContentPart[];
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** abort budget; providers should honour it so a hung model can't wedge a request */
  timeoutMs?: number;
}

export interface ChatProvider {
  /** identifies the backing implementation in logs and errors */
  readonly name: string;
  chat(messages: AiMessage[], opts: ChatOptions): Promise<string>;
}

// ── tool calling (aiChatWithTools) ──────────────────────────────────────────

/** A function the model may call, in the OpenAI `tools` shape. `parameters` is a JSON Schema object. */
export interface AiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** One call the model asked for; `arguments` is the raw JSON string it wrote (may not parse). */
export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The conversation of a tool loop: plain messages plus the model's calls and their results. */
export type AiToolMessage =
  | AiMessage
  | {
      role: "assistant";
      content: string | null;
      tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolChatOptions {
  /** the answer's budget, reasoning included where the model reasons */
  maxTokens?: number;
  /** sent only when set: reasoning deployments accept nothing but their default */
  temperature?: number;
  /** "low" | "medium" | "high" on reasoning deployments; omitted when unset */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  toolChoice?: "auto" | "none" | "required";
  timeoutMs?: number;
  /** the caller's own abort (a client that went away, a loop's overall budget) */
  signal?: AbortSignal;
}

export interface ToolChatResult {
  content: string | null;
  toolCalls: AiToolCall[];
  /** "stop" | "tool_calls" | "length" | … as the upstream said it; null when it said nothing */
  finishReason: string | null;
}

/** A provider that can also run one tool-calling turn. Separate from ChatProvider so `chat` stays as it is. */
export interface ToolChatProvider extends ChatProvider {
  chatWithTools(messages: AiToolMessage[], tools: AiTool[], opts: ToolChatOptions): Promise<ToolChatResult>;
}
