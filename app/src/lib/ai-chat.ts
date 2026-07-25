import "server-only";
import { aiChat, unfence, type AiMessage } from "./ai";

/**
 * AI chat reply generation.
 *
 * Live: streams the vLLM (`aiChat`) result in chunks.
 * e2e/CI: with `AI_FAKE_LLM=1`, streams **deterministic** input-derived
 * markdown (headings, bold, lists, code, tables) — render/stream/abort
 * tests run reliably with no real LLM.
 */

export const FAKE_LLM = process.env.AI_FAKE_LLM === "1";

const SYSTEM_PROMPT =
  "You are the workspace AI, a concise helpful assistant. " +
  "Answer in the user's language. Use Markdown.";

/** Builds the chat title from the first user message. */
export function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
}

/** Deterministic fake reply body. Echoes the input and includes every render-test element. */
function fakeReply(userText: string): string {
  const echo = userText.replace(/\s+/g, " ").trim().slice(0, 200);
  return [
    `## Summary`,
    ``,
    `Here is what you asked about: **"${echo}"**. Summary below.`,
    ``,
    `- First key point`,
    `- Second key point`,
    `- Third key point`,
    ``,
    "```js",
    `// example code`,
    `function greet(name) {`,
    `  return \`Hello, \${name}\`;`,
    `}`,
    "```",
    ``,
    `| Item | Value |`,
    `| --- | --- |`,
    `| Status | Done |`,
    `| Priority | High |`,
    ``,
    `> Ask a follow-up any time.`,
    ``,
    `See the [docs](https://example.com/docs) or visit https://example.com directly.`,
    ``,
    `Mass-energy equivalence: $E=mc^2$`,
    ``,
    `$$\\sum x$$`,
    ``,
    `![Chart 1](https://dummy.local/chart1.png)`,
    `![Chart 2](https://dummy.local/chart2.png)`,
  ].join("\n");
}

/** Split text into streaming chunks (word boundaries, newlines preserved). */
function* chunk(text: string): Generator<string> {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  let buf = "";
  for (const tok of tokens) {
    buf += tok;
    if (buf.length >= 8) {
      yield buf;
      buf = "";
    }
  }
  if (buf) yield buf;
}

/**
 * Async generator that streams the reply chunk by chunk.
 * Each chunk is a text fragment to render (not cumulative).
 */
export async function* streamReply(
  history: AiMessage[],
  userText: string,
  opts: { forceFake?: boolean } = {}
): AsyncGenerator<string> {
  const fake = FAKE_LLM || opts.forceFake === true;
  let full: string;
  if (fake) {
    full = fakeReply(userText);
  } else {
    const messages: AiMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userText },
    ];
    full = unfence(await aiChat(messages, { maxTokens: 1024 }));
  }
  if (fake) {
 // e2e: emit everything at once, no chunks or delays. Even on an
 // overloaded server the SSE completes in a single flush, dodging send
 // timeouts (streaming behavior is observed on the real-LLM path).
    yield full;
    return;
  }
  for (const c of chunk(full)) {
    yield c;
  }
}
