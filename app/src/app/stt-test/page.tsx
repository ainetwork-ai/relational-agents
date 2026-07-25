"use client";

import { useEffect, useRef, useState } from "react";

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
  const [log, setLog] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const [device, setDevice] = useState<string>("");
  const [lang, setLang] = useState("en-US");
  const [sttOn, setSttOn] = useState(false);
  const recRef = useRef<RecLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  const add = (s: string) =>
    setLog((l) => [...l.slice(-120), `${new Date().toLocaleTimeString("en-GB")}  ${s}`]);

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
      add("ENGINE: NONE — 이 브라우저에는 Web Speech가 없습니다 (Chrome 필요)");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => add(`STT started (lang=${lang}) — 말하세요`);
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        add(`${r.isFinal ? "FINAL " : "interim"}: ${r[0].transcript}`);
      }
    };
    rec.onerror = (ev) => add(`ERROR: ${ev.error}`);
    rec.onend = () => add("ended (엔진이 세션을 닫음 — 재시작하려면 Start STT)");
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

  const btn =
    "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8 font-mono text-sm">
      <h1 className="text-lg font-bold">STT 진단 (/stt-test)</h1>

      <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="font-semibold">1단계 — 마이크가 소리를 받고 있는가</h2>
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
          {device ? `입력 장치: ${device}` : "Start Mic 후 말하면 초록 막대가 움직여야 합니다. 안 움직이면 macOS 사운드 입력 장치 문제."}
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="font-semibold">2단계 — Web Speech가 텍스트를 만드는가</h2>
        <div className="flex items-center gap-3">
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 dark:border-neutral-700">
            <option value="en-US">en-US (영어)</option>
            <option value="ko-KR">ko-KR (한국어)</option>
          </select>
          <button onClick={sttOn ? stopStt : startStt} className={`${btn} ${sttOn ? "bg-red-600" : "bg-blue-600"}`}>
            {sttOn ? "Stop STT" : "Start STT"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          모든 이벤트를 필터 없이 기록합니다. 말했는데 interim조차 없으면 → 1단계 확인;
          ERROR: network → 구글 음성 서비스 차단 (Web Speech 불가, Azure/외부 STT 필요);
          FINAL이 찍히면 → STT 정상, 통화의 utterance 전송도 동작합니다 (그 뒷단은 e2e로 증명됨).
        </p>
      </section>

      <section className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-semibold">이벤트 로그</h2>
        <div ref={logRef} className="h-64 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs text-green-400">
          {log.length ? log.join("\n") : "(비어 있음)"}
        </div>
      </section>
    </div>
  );
}
