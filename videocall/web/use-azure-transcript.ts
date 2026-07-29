"use client";
// React hook — drop-in replacement for the notion plan's use-speech-transcript.ts.
// Same interface contract:
//   const { interim, supported, error } = useSpeechTranscript({ enabled, lang, onFinal });
// Copy this file into app/src/hooks/ (or import it) and install:
//   pnpm add microsoft-cognitiveservices-speech-sdk
// Env (client-direct, demo only — do not commit keys):
//   NEXT_PUBLIC_AZURE_SPEECH_KEY / NEXT_PUBLIC_AZURE_SPEECH_REGION

import { useEffect, useRef, useState } from "react";
import { createAzureTranscript } from "./azure-transcript.js";

const AZURE_KEY = process.env.NEXT_PUBLIC_AZURE_SPEECH_KEY ?? "";
const AZURE_REGION = process.env.NEXT_PUBLIC_AZURE_SPEECH_REGION ?? "";
export const STT_LANG = "en-US";

export function useSpeechTranscript({
  enabled,
  lang = STT_LANG,
  onFinal,
}: {
  enabled: boolean;
  lang?: string;
  onFinal: (text: string) => void;
}) {
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supported = Boolean(AZURE_KEY && AZURE_REGION);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (!enabled || !supported) return;
    let disposed = false;
    let handle: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;

    (async () => {
      const sdk = await import("microsoft-cognitiveservices-speech-sdk");
      if (disposed) return;
      handle = createAzureTranscript({
        sdk,
        key: AZURE_KEY,
        region: AZURE_REGION,
        lang,
        onInterim: (text: string) => setInterim(text),
        onFinal: (text: string) => onFinalRef.current(text),
        onError: (message: string) => setError(message),
      });
      await handle.start().catch((err: unknown) => setError(String(err)));
    })();

    return () => {
      disposed = true;
      setInterim("");
      handle?.stop();
    };
  }, [enabled, supported, lang]);

  return { interim, supported, error };
}
