"use client";

import { useEffect, useRef, useState } from "react";

/** Demo scripts are English; override per-call via the `lang` option. */
const STT_LANG = "en-US";

// Chrome-only Web Speech API — minimal typings (not in lib.dom).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function makeRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export interface SpeechTranscriptOptions {
  /** transcribe only while true (call active, mic on) */
  enabled: boolean;
  /** BCP-47 tag; defaults to STT_LANG */
  lang?: string;
  /** confirmed utterance (trimmed, ≥2 chars) — the "🎙 " prefix is the caller's job */
  onFinal: (text: string) => void;
}

/**
 * Transcribes the local mic with the Web Speech API while `enabled`.
 * Signature follows videocall/CONTRACT.md §1, so the Azure engine
 * (videocall/web/use-azure-transcript.ts) is a one-line import swap.
 * Chrome auto-stops recognition after silence (and on transient "network"/
 * "no-speech" errors), so onend restarts it while enabled; "not-allowed"
 * stops it for good (mic permission denied).
 */
export function useSpeechTranscript({ enabled, lang, onFinal }: SpeechTranscriptOptions) {
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  // SSR renders with true (no window); the badge this feeds is hidden until
  // the call is active, so the hydration diff is invisible
  const [supported, setSupported] = useState(
    () =>
      typeof window === "undefined" ||
      !!(
        (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
          .SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
      )
  );
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });
  // Chrome occasionally finalizes the same sentence twice back to back —
  // without this the agent hears everything said twice
  const lastFinalRef = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!enabled) return;
    const rec = makeRecognition();
    if (!rec) return; // supported already false from the initializer
    let active = true;
    let dead = false;
    rec.lang = lang ?? STT_LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let pending = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          const dup =
            text === lastFinalRef.current.text && Date.now() - lastFinalRef.current.at < 3000;
          if (text.length >= 2 && !dup) {
            lastFinalRef.current = { text, at: Date.now() };
            onFinalRef.current(text);
          }
        } else {
          pending += ` ${text}`;
        }
      }
      setError(null);
      setInterim(pending.trim());
    };
    rec.onerror = (ev) => {
      // 'aborted' is lifecycle noise (our own stop/restart — StrictMode
      // replays the effect and the dying instance fires it) and 'no-speech'
      // is just silence; neither means the engine is broken, and both were
      // painting a sticky "STT error" badge that only a successful result
      // could clear.
      if (ev.error === "aborted" || ev.error === "no-speech") return;
      setError(ev.error);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        dead = true;
        setSupported(false);
      }
    };
    rec.onend = () => {
      setInterim("");
      if (!active || dead) return;
      // Chrome ends recognition after ~seconds of silence — restart fast:
      // the gap is deaf time, and a long one eats the first syllable of
      // whatever is said next
      setTimeout(() => {
        if (!active || dead) return;
        try {
          rec.start();
        } catch {
          /* InvalidStateError when already restarted */
        }
      }, 80);
    };
    try {
      rec.start();
    } catch {
      /* already started */
    }
    return () => {
      active = false;
      // a dying instance must not keep writing state — the replacement owns it
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.stop();
      } catch {}
      setInterim("");
    };
  }, [enabled, lang]);

  return { interim, supported, error };
}
