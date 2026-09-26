"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/provider";

/**
 * /stt-test — step-by-step STT diagnosis, no call required.
 *
 * The in-call badge can only say "listening"; when utterances still don't
 * flow, the question splits into independently testable stages:
 *   1. does the mic deliver AUDIO?         → live level meter
 *   2. does Web Speech deliver TEXT?       → raw event log (nothing filtered)
 * The utterance POST chain past onFinal is covered by e2e (stubbed finals
 * reach the server as 201s), so a transcript here = the whole path works.
 */

interface RecLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function SttTestPage() {
  const t = useT();
  const [log, setLog] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [device, setDevice] = useState<string>("");
  const [lang, setLang] = useState("en-US");
  const [sttOn, setSttOn] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [postOn, setPostOn] = useState(true);
  const roomIdRef = useRef("");
  const postOnRef = useRef(true);
  roomIdRef.current = roomId.trim();
  postOnRef.current = postOn;
  const recRef = useRef<RecLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  const add = (s: string) => {
    setLog((l) => [...l.slice(-120), `${new Date().toLocaleTimeString("en-GB")}  ${s}`]);
    // headless-free automation: significant events surface in the tab title
    // so a script (or AppleScript) can read the verdict without a debugger
    if (/FINAL|ERROR|ENGINE|MIC/.test(s)) document.title = `STT-TEST ${s.slice(0, 80)}`;
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // ---- step 1: mic level ----
  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setDevice(stream.getAudioTracks()[0]?.label ?? "(unknown device)");
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(100, Math.round((peak / 128) * 200)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMicOn(true);
      add(`MIC OK — device: ${stream.getAudioTracks()[0]?.label}`);
    } catch (e) {
      add(`MIC FAILED: ${e instanceof Error ? e.name : String(e)}`);
    }
  }
  function stopMic() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMicOn(false);
    setLevel(0);
    add("MIC stopped");
  }

  // ---- step 2: raw Web Speech (NOTHING filtered — every event logged) ----
  function startStt() {
    const w = window as unknown as {
      SpeechRecognition?: new () => RecLike;
      webkitSpeechRecognition?: new () => RecLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      add("ENGINE: NONE — this browser has no Web Speech (Chrome required)");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => add(`STT started (lang=${lang}) — speak now`);
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        add(`${r.isFinal ? "FINAL " : "interim"}: ${r[0].transcript}`);
        // step 3: a finalized sentence rides the REAL pipeline
        if (r.isFinal && postOnRef.current && roomIdRef.current) {
          const text = r[0].transcript.trim();
          if (text.length < 2) continue;
          void fetch(`/api/calls/${roomIdRef.current}/utterance`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          })
            .then(async (res) =>
              add(
                `utterance POST → ${res.status}${
                  res.ok ? "" : ` (${(await res.json().catch(() => ({})))?.error ?? "?"})`
                }`
              )
            )
            .catch((e) => add(`utterance POST FAILED: ${String(e).slice(0, 60)}`));
        }
      }
    };
    rec.onerror = (ev) => add(`ERROR: ${ev.error}`);
    rec.onend = () => add("ended (the engine closed the session — Start STT to restart)");
    rec.start();
    recRef.current = rec;
    setSttOn(true);
  }
  function stopStt() {
    recRef.current?.stop();
    recRef.current = null;
    setSttOn(false);
  }

  useEffect(() => () => { stopMic(); recRef.current?.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ?auto=1 — start both stages on load (fake-media Chrome grants without a
  // prompt), so a launched browser window IS the test run
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get("auto")) return;
    const t = setTimeout(() => {
      void startMic();
      startStt();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // room id: ?room= wins, else the last one used on this browser
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("room");
    const saved = localStorage.getItem("stt-test-room") ?? "";
    if (q || saved) setRoomId(q ?? saved);
  }, []);
  useEffect(() => {
    if (roomId.trim()) localStorage.setItem("stt-test-room", roomId.trim());
  }, [roomId]);

  const btn =
    "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8 font-mono text-sm">
      <h1 className="text-lg font-bold">{t("STT diagnostics (/stt-test)")}</h1>

      <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="font-semibold">{t("Step 1 — is the mic picking up sound?")}</h2>
        <div className="flex items-center gap-3">
          <button onClick={micOn ? stopMic : startMic} className={`${btn} ${micOn ? "bg-red-600" : "bg-blue-600"}`}>
            {micOn ? "Stop Mic" : "Start Mic"}
          </button>
          <div className="h-3 w-64 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${level}%` }} />
          </div>
          <span className="w-10 text-right">{level}</span>
        </div>
        <p className="text-xs text-neutral-500">
          {device ? t("Input device: {device}", { device }) : t("After Start Mic, the green bar should move when you speak. If it doesn't, it's a macOS sound input device problem.")}
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="font-semibold">{t("Step 2 — does Web Speech produce text?")}</h2>
        <div className="flex items-center gap-3">
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 dark:border-neutral-700">
            <option value="en-US">{t("en-US (English)")}</option>
            <option value="ko-KR">{t("ko-KR (Korean)")}</option>
          </select>
          <button onClick={sttOn ? stopStt : startStt} className={`${btn} ${sttOn ? "bg-red-600" : "bg-blue-600"}`}>
            {sttOn ? "Stop STT" : "Start STT"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          {t("Every event is logged, nothing filtered. Spoke but not even an interim → check step 1;")}
          {" "}{t("ERROR: network → Google's speech service is blocked (no Web Speech; Azure/external STT needed);")}
          {" "}{t("FINAL shows up → STT is fine, and the call's utterance sending works too (the rest of the chain is proven by e2e).")}
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="font-semibold">{t("Step 3 — does a FINAL actually go through the utterance API?")}</h2>
        <div className="flex items-center gap-3">
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t("room id (e.g. {id})", { id: "184cc64d-44c6-48e6-9b20-267cd64d4559" })}
            className="w-96 rounded border border-neutral-300 bg-transparent px-2 py-1.5 dark:border-neutral-700"
          />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={postOn} onChange={(e) => setPostOn(e.target.checked)} />
            {t("POST on FINAL")}
          </label>
        </div>
        <p className="text-xs text-neutral-500">
          {t("Each finalized sentence is sent to POST /api/calls/{room}/utterance and the response code is logged.")}
          {" "}{t("201 = success (the agent read it). 409 \"No active call\" = that room needs a")} <b>{t("call in progress")}</b>
          {t(" (connect a call in another window, then test). 401/403 = this browser session is not a member of the room.")}
          {" "}{t("Prefill with ?room=<id>.")}
        </p>
      </section>

      <section className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-semibold">{t("Event log")}</h2>
        <div ref={logRef} className="h-64 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs text-green-400">
          {log.length ? log.join("\n") : t("(empty)")}
        </div>
      </section>
    </div>
  );
}
