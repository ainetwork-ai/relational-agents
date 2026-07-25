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
          if (text.length >= 2) onFinalRef.current(text);
        } else {
          pending += ` ${text}`;
        }
      }
      setError(null);
      setInterim(pending.trim());
    };
    rec.onerror = (ev) => {
      setError(ev.error);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        dead = true;
        setSupported(false);
      }
    };
    rec.onend = () => {
      setInterim("");
      if (!active || dead) return;
      // Chrome ends recognition after ~seconds of silence — restart
      setTimeout(() => {
        if (!active || dead) return;
        try {
          rec.start();
        } catch {
          /* InvalidStateError when already restarted */
        }
      }, 250);
    };
    try {
      rec.start();
    } catch {
      /* already started */
    }
    return () => {
      active = false;
      rec.onend = null;
      try {
        rec.stop();
      } catch {}
      setInterim("");
    };
  }, [enabled, lang]);

  return { interim, supported, error };
}
