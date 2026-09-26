"use client";
// Font specimen via the FontFace API: the browser's own font parser (OTS
// sanitizes it) loads the file under a throwaway family name.
import { useEffect, useState } from "react";
import type { PreviewProps } from "./types";
import { usePreviewBytes } from "./use-preview-bytes";
import { PreviewLoading, PreviewMessage } from "./status";
import { readFontNames, type FontNames } from "./font-name";
import { HANGUL_PANGRAM, HANGUL_SYLLABLES } from "@/i18n/content/components";

const SIZES = [12, 18, 24, 36, 48, 72];
const DEFAULT_SAMPLE = `${HANGUL_PANGRAM} · The quick brown fox jumps over the lazy dog`;
const CHARSET = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  HANGUL_PANGRAM,
  HANGUL_SYLLABLES,
];

let seq = 0;

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; family: string; names: FontNames };

export default function FontPreview({ src }: PreviewProps) {
  const bytes = usePreviewBytes(src);
  const [state, setState] = useState<State>({ status: "loading" });
  const [sample, setSample] = useState(DEFAULT_SAMPLE);

  useEffect(() => {
    if (bytes.status !== "ready") return;
    let cancelled = false;
    const family = `file-preview-font-${++seq}`;
    const face = new FontFace(family, bytes.data);
    Promise.all([face.load(), readFontNames(bytes.data)]).then(
      ([loaded, names]) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setState({ status: "ready", family, names });
      },
      () => { if (!cancelled) setState({ status: "error" }); },
    );
    return () => {
      cancelled = true;
      document.fonts.delete(face);
    };
  }, [bytes]);

  if (bytes.status === "error") return <PreviewMessage name={src.name} message={bytes.message} />;
  if (state.status === "error") {
    return <PreviewMessage name={src.name} message="This file isn't a font the browser can load (it may be damaged or an unsupported format). Download it to open it." />;
  }
  if (state.status !== "ready") return <PreviewLoading />;

  const { family, names } = state;
  const title = names.family ?? src.name.replace(/\.[^.]+$/, "");
  const fontStyle = { fontFamily: `"${family}", system-ui` };
  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 min-w-0">
      <header className="min-w-0">
        <h2 className="text-3xl font-semibold text-neutral-800 dark:text-neutral-200 break-words" style={fontStyle}>{title}</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          {[names.style, src.name.split(".").pop()?.toUpperCase()].filter(Boolean).join(" · ")}
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] tracking-wide uppercase text-neutral-500 dark:text-neutral-400">Sample text</span>
        <input
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="Type to preview"
          className="h-9 px-3 rounded-md border border-neutral-200 dark:border-neutral-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <section className="flex flex-col gap-4">
        {SIZES.map((px) => (
          <div key={px} className="flex flex-col gap-1 min-w-0">
            <span className="text-[11px] tracking-wide text-neutral-500 dark:text-neutral-400 tabular-nums">{px}px</span>
            <p className="text-neutral-800 dark:text-neutral-200 break-words leading-tight" style={{ ...fontStyle, fontSize: px }}>
              {sample || DEFAULT_SAMPLE}
            </p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-700 pt-4">
        <span className="text-[11px] tracking-wide uppercase text-neutral-500 dark:text-neutral-400">Characters</span>
        {CHARSET.map((line) => (
          <p key={line} className="text-neutral-800 dark:text-neutral-200 break-all text-[22px] leading-snug" style={fontStyle}>{line}</p>
        ))}
      </section>
    </div>
  );
}
