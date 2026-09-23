"use client";
// Text / markdown / code: a lightweight read-only view (no editor). Markdown
// is shown as its source — it is only a preview; the file itself stays put.
import { useEffect, useState } from "react";
import type { PreviewProps } from "./types";
import { PreviewLoading, PreviewMessage } from "./status";
import { prettyBytes } from "./file-icon";

/** Only the head of a huge log is decoded — the rest is one download away. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; text: string; clipped: boolean };

export default function TextPreview({ src }: PreviewProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // The raw URL may be a Range-capable stream; ask only for the head so a
    // multi-GB log doesn't come down whole. Servers that ignore Range send
    // the whole body — slice it below either way.
    const load = src.url.startsWith("blob:")
      ? src.bytes()
      : fetch(src.url, { headers: { Range: `bytes=0-${MAX_TEXT_BYTES - 1}` } }).then((r) => {
          if (r.status === 416) return new ArrayBuffer(0); // empty file: no byte 0 to serve
          if (!r.ok) throw new Error(`Could not load the file (${r.status}).`);
          return r.arrayBuffer();
        });
    load.then(
      (buf) => {
        if (cancelled) return;
        const clipped = buf.byteLength > MAX_TEXT_BYTES || src.size > MAX_TEXT_BYTES;
        // Non-fatal: invalid UTF-8 (a Latin-1 CSV, a cut multi-byte char at
        // the clip edge) renders as U+FFFD rather than failing.
        const text = new TextDecoder("utf-8").decode(buf.slice(0, MAX_TEXT_BYTES));
        setState({ status: "ready", text, clipped });
      },
      (e: unknown) => { if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "Could not load the file." }); },
    );
    return () => { cancelled = true; };
  }, [src]);

  if (state.status === "loading") return <PreviewLoading />;
  if (state.status === "error") return <PreviewMessage name={src.name} message={state.message} />;
  return (
    <div className="min-w-0">
      <pre className="m-0 p-4 text-[12px] leading-5 font-mono text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words">{state.text}</pre>
      {state.clipped && (
        <p className="px-4 pb-4 text-xs text-neutral-500 dark:text-neutral-400">
          Showing the first {prettyBytes(MAX_TEXT_BYTES)} — download for the full file.
        </p>
      )}
    </div>
  );
}
