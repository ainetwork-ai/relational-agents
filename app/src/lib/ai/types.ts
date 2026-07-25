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
