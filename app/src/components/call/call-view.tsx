"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { newId } from "@/lib/compat";
import { useDmEvents } from "@/hooks/use-dm-events";
import { useSpeechTranscript } from "@/hooks/use-speech-transcript";
import { adoptCallMedia, CALL_MEDIA_CONSTRAINTS } from "@/lib/call-prewarm";
import { DmView } from "@/app/(app)/dm/[roomId]/dm-view";
import { DmAvatar } from "@/components/dm/dm-avatar";
import type { DmUser } from "@/stores/dm-rooms";

interface CallSdp {
  type: string;
  sdp: string;
}
interface CallState {
  roomId: string;
  callerId: string;
  status: "ringing" | "active";
  offer?: CallSdp;
  answer?: CallSdp;
}
type ViewStatus = "loading" | "ringing-out" | "active" | "declined" | "ended";

/** Wait for non-trickle ICE: full SDP in one blob, capped so a stall can't
 * hang the call. With TURN servers configured, gathering rarely reaches
 * "complete" before the cap — so a 350ms lull in candidate arrivals also
 * counts as done (the SDP already carries everything gathered so far).
 * Same-machine handshakes drop from a hard 2s to ~0.4s. */
function waitIceComplete(pc: RTCPeerConnection, capMs = 2000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let lull: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidate", onCandidate);
      clearTimeout(timer);
      clearTimeout(lull);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const onCandidate = (ev: RTCPeerConnectionIceEvent) => {
      clearTimeout(lull);
      if (ev.candidate) lull = setTimeout(done, 350);
    };
    const timer = setTimeout(done, capMs);
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", onCandidate);
  });
}

/** ICE config: STUN always; TURN from env when provided (self-hosted coturn
 * runs on the dev box but the router blocks 3478 from outside — flip the env
 * once the port is forwarded), else the demo-grade openrelay free tier. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [
        {
          urls: process.env.NEXT_PUBLIC_TURN_URL,
          username: process.env.NEXT_PUBLIC_TURN_USERNAME ?? "",
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL ?? "",
        },
      ]
    : [
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ]),
];

/** Outgoing ringback — the ONE state that sounds is "Calling…". WebAudio
 * dual-tone like the incoming ringtone, slower cadence. Returns the stop
 * function; the caller manages it from an effect so cleanup is the single,
 * unavoidable stop path (StrictMode replay and navigation included). */
function startRingback(): (() => void) | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    o1.frequency.value = 440;
    const o2 = ctx.createOscillator();
    o2.frequency.value = 480;
    o1.connect(gain);
    o2.connect(gain);
    o1.start();
    o2.start();
    const burst = () => {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.setValueAtTime(0, t + 1.5);
    };
    burst();
    const iv = setInterval(burst, 4000);
    return () => {
      clearInterval(iv);
      void ctx.close();
    };
  } catch {
    return null;
  }
}

/**
 * The in-call view: WebRTC state machine + layout (remote video main, local
 * PiP, controls, transcript panel right). Signaling is notify-then-refetch —
 * every dm-call-* event (and SSE hello) triggers a GET of the call state, and
 * `sync` applies whatever is new; refs make each SDP step idempotent, so a
 * duplicated or missed event never double-applies or deadlocks.
 */
export function CallView({ roomId }: { roomId: string }) {
  const router = useRouter();
  const clientId = useMemo(() => newId(), []);
  const [status, setStatus] = useState<ViewStatus>("loading");
  const [meId, setMeId] = useState<string | null>(null);
  const [members, setMembers] = useState<DmUser[]>([]);
  const [rootPageId, setRootPageId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteLive, setRemoteLive] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const iAmCallerRef = useRef(false); // sync() keeps this current for the ICE handler
  const lastRestartRef = useRef(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockIdxRef = useRef(0); // cycles the mock-utterance lines
  const offerPostedRef = useRef(false); // caller: my offer went out
  const acceptPostedRef = useRef(false); // callee-on-/call: auto-accept sent once
  // idempotency by CONTENT, not a boolean: joining a leftover call means the
  // stored SDP can be replaced mid-flight (a fresh caller re-offers), and a
  // boolean would refuse to answer the new offer — stuck on "Connecting…"
  const answeredOfferRef = useRef<string | null>(null); // callee: offer sdp I answered
  const appliedAnswerRef = useRef<string | null>(null); // caller: answer sdp I applied
  const syncingRef = useRef(false);
  const endedRef = useRef(false);

  const partner = members.find((m) => m.id !== meId && !m.isAgent) ?? null;

  // ---- room context (names, record page for the end-of-call destination) ----
  useEffect(() => {
    let alive = true;
    fetch(`/api/dm/rooms/${roomId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setMeId(d.meId);
        setMembers(d.members ?? []);
        setRootPageId(d.room?.rootPageId ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [roomId]);

  // ---- media ----
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    // the incoming-call card warms the camera while the phone rings —
    // adopting it skips the ~1s device acquisition on the connect path
    const warm = adoptCallMedia(roomId);
    if (warm) {
      localStreamRef.current = warm;
      if (localVideoRef.current) localVideoRef.current.srcObject = warm;
      return warm;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CALL_MEDIA_CONSTRAINTS);
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (err) {
      // denied/missing devices — without this the failure was swallowed and
      // the OTHER side sat on "Connecting…" with no idea why
      setMediaError(true);
      throw err;
    }
  }, [roomId]);

  // A mid-call network blip used to freeze the video forever — nobody
  // listened to the ICE state. The CALLER drives recovery (re-offer with
  // iceRestart; the server voids the old answer and the callee re-answers
  // because its idempotency is keyed by offer content).
  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || endedRef.current || !iAmCallerRef.current) return;
    if (Date.now() - lastRestartRef.current < 8_000) return; // one attempt per blip
    lastRestartRef.current = Date.now();
    try {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      await waitIceComplete(pc);
      await fetch(`/api/calls/${roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ action: "offer", sdp: pc.localDescription }),
      });
    } catch {
      /* the next ICE state change retries */
    }
  }, [roomId, clientId]);

  const ensurePc = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    // candidate pool: gathering starts at construction, not at offer time —
    // by the time the SDP is created the candidates are already in hand
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 1 });
    const stream = await ensureLocalStream();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.ontrack = (ev) => {
      if (remoteVideoRef.current && ev.streams[0]) {
        remoteVideoRef.current.srcObject = ev.streams[0];
        setRemoteLive(true);
      }
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === "connected" || st === "completed") {
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        setReconnecting(false);
        return;
      }
      if (st === "failed") {
        setReconnecting(true);
        void restartIce();
      } else if (st === "disconnected") {
        // often self-heals within seconds — restart only if it doesn't
        setReconnecting(true);
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = setTimeout(() => void restartIce(), 4_000);
      }
    };
    pcRef.current = pc;
    return pc;
  }, [ensureLocalStream, restartIce]);

  const teardown = useCallback(() => {
    if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, []);

  const leave = useCallback(
    (to: "record" | "room" = "record") => {
      if (endedRef.current) return;
      endedRef.current = true;
      teardown();
      void fetch(`/api/calls/${roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ action: "end" }),
        keepalive: true,
      });
      router.push(to === "record" && rootPageId ? `/p/${rootPageId}` : `/dm/${roomId}`);
    },
    [roomId, rootPageId, clientId, router, teardown]
  );

  // ---- signaling: refetch state and advance the machine ----
  const sync = useCallback(async () => {
    if (syncingRef.current || endedRef.current) return;
    syncingRef.current = true;
    try {
      const res = await fetch(`/api/calls/${roomId}`);
      if (!res.ok) return;
      const { call } = (await res.json()) as { call: CallState | null };
      if (!call) {
        // no live call — declined/cancelled/ended elsewhere, or a stale open
        // tab. "loading" leaves too: a decline can land before this view
        // finishes mounting, and showing "Call ended" without navigating
        // strands the caller on /call.
        if (status === "active" || status === "ringing-out" || status === "loading") {
          endedRef.current = true;
          teardown();
          setStatus("ended");
          router.push(rootPageId ? `/p/${rootPageId}` : `/dm/${roomId}`);
        }
        return;
      }
      const iAmCaller = meId !== null && call.callerId === meId;
      iAmCallerRef.current = iAmCaller;
      if (call.status === "ringing") {
        // pre-warm while the phone rings: camera/mic AND the peer connection
        // (its candidate pool gathers in the background), so accept → offer
        // is instant instead of paying getUserMedia + ICE on the spot
        void ensurePc().catch(() => {});
        if (!iAmCaller && meId !== null && !acceptPostedRef.current) {
          // I'm standing on the call page while the other side rings me:
          // either we both dialed at once (glare — my invite lost the race
          // and 409-joined theirs) or I navigated straight in. Both mean yes
          // — auto-accept and the two calls merge into one.
          acceptPostedRef.current = true;
          await fetch(`/api/calls/${roomId}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-client-id": clientId },
            body: JSON.stringify({ action: "accept" }),
          });
          return; // the accept event re-syncs into the active branch
        }
        setStatus(iAmCaller ? "ringing-out" : "loading");
        return;
      }
      // active
      setStatus("active");
      if (iAmCaller) {
        if (!offerPostedRef.current) {
          offerPostedRef.current = true;
          const pc = await ensurePc();
          await pc.setLocalDescription(await pc.createOffer());
          await waitIceComplete(pc);
          await fetch(`/api/calls/${roomId}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-client-id": clientId },
            body: JSON.stringify({ action: "offer", sdp: pc.localDescription }),
          });
        }
        if (call.answer && appliedAnswerRef.current !== call.answer.sdp) {
          appliedAnswerRef.current = call.answer.sdp;
          const pc = await ensurePc();
          await pc.setRemoteDescription(call.answer as RTCSessionDescriptionInit);
        }
      } else if (call.offer && answeredOfferRef.current !== call.offer.sdp) {
        answeredOfferRef.current = call.offer.sdp;
        const pc = await ensurePc();
        await pc.setRemoteDescription(call.offer as RTCSessionDescriptionInit);
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIceComplete(pc);
        await fetch(`/api/calls/${roomId}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-client-id": clientId },
          body: JSON.stringify({ action: "answer", sdp: pc.localDescription }),
        });
      }
    } catch {
      /* transient — next event/hello retries */
    } finally {
      syncingRef.current = false;
    }
  }, [roomId, meId, status, clientId, rootPageId, router, ensurePc, ensureLocalStream, teardown]);

  // run once the room context (meId) is known, and on every call event
  useEffect(() => {
    if (!meId) return;
    const t = setTimeout(() => void sync(), 0); // async kickoff (lint: no sync setState in effects)
    return () => clearTimeout(t);
  }, [meId, sync]);

  useDmEvents(
    (event) => {
      if (event.roomId !== roomId || !event.type.startsWith("dm-call-")) return;
      if (event.type === "dm-call-decline") {
        teardown();
        setStatus("declined");
        setTimeout(() => leave("room"), 1600);
        return;
      }
      if (event.type === "dm-call-end" || event.type === "dm-call-cancel") {
        if (event.clientId !== clientId) {
          endedRef.current = true;
          teardown();
          setStatus("ended");
          router.push(rootPageId ? `/p/${rootPageId}` : `/dm/${roomId}`);
        }
        return;
      }
      void sync();
    },
    () => void sync()
  );

  // leaving the page (unmount) ends the call for both sides
  useEffect(() => {
    const mountedAt = Date.now();
    return () => {
      // dev StrictMode replays mount→cleanup→mount; a sub-second "unmount"
      // is that replay, not the user leaving — ending here would kill the
      // call the moment it opens
      if (Date.now() - mountedAt < 800) return;
      if (!endedRef.current) {
        endedRef.current = true;
        teardown();
        void fetch(`/api/calls/${roomId}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-client-id": clientId },
          body: JSON.stringify({ action: "end" }),
          keepalive: true,
        });
      }
    };
  }, [roomId, clientId, teardown]);

  // an unanswered outgoing ring gives up like a real phone (the callee's
  // incoming card auto-dismisses at 30s too); ending mid-ring records Missed
  useEffect(() => {
    if (status !== "ringing-out") return;
    const t = setTimeout(() => leave("room"), 30_000);
    return () => clearTimeout(t);
  }, [status, leave]);

  // ringback sounds while Calling… and ONLY then — accept, decline, cancel,
  // end or leaving all pass through a status change, so the cleanup is the
  // guaranteed stop
  useEffect(() => {
    if (status !== "ringing-out") return;
    const stop = startRingback();
    return () => stop?.();
  }, [status]);

  // blocked camera/mic ends the call visibly — lingering would leave the
  // other side ringing at a peer that can never send media
  useEffect(() => {
    if (!mediaError) return;
    const t = setTimeout(() => leave("room"), 2500);
    return () => clearTimeout(t);
  }, [mediaError, leave]);

  // the offer/answer dance is SSE-notification driven and a missed
  // dm-call-signal used to park "Connecting…" until the next reconnect —
  // poll as a backup while the handshake is still open. 500ms: the timeline
  // showed the callee routinely missing the offer notification right after
  // navigation and paying a full poll tick, so the tick must be cheap.
  useEffect(() => {
    if (remoteLive) return;
    if (status !== "active" && status !== "loading" && status !== "ringing-out") return;
    const iv = setInterval(() => void sync(), 500);
    return () => clearInterval(iv);
  }, [status, remoteLive, sync]);

  // heartbeat — the server reclaims calls whose participants stopped beating
  // (a crashed browser never sends the pagehide end)
  useEffect(() => {
    if (status !== "active" && status !== "ringing-out") return;
    const beat = () =>
      void fetch(`/api/calls/${roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ action: "heartbeat" }),
      }).catch(() => {});
    beat();
    const iv = setInterval(beat, 10_000);
    return () => clearInterval(iv);
  }, [status, roomId, clientId]);

  // a page that dies mid-call (refresh/close) must not leave a ghost call —
  // the next ring would silently 409-join it and sit on stale SDP forever
  useEffect(() => {
    const onHide = () => {
      if (endedRef.current) return;
      navigator.sendBeacon(
        `/api/calls/${roomId}`,
        new Blob([JSON.stringify({ action: "end" })], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [roomId]);

  // ---- STT: my mic → the agent's ear (never the transcript) ----
  // ON by default — utterances must reach /utterance for the agent's in-call
  // whispers and the end-of-call summary. Known cost until the external STT
  // feed replaces this engine: Web Speech re-opens the mic on every
  // silence-restart, so the capture indicator blinks. Set the env to "0" to
  // silence the engine entirely.
  const webSpeechOn = process.env.NEXT_PUBLIC_CALL_WEB_SPEECH !== "0";
  // recognition language: ?stt=ko-KR beats the env beats en-US — deployment
  // stays English while a tester can flip one call to Korean from the URL
  const [sttLang] = useState<string | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("stt") ??
        process.env.NEXT_PUBLIC_STT_LANG
  );
  // diagnostics live behind ?debug=1 — the demo stage stays clean
  const [debugOn] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "1"
  );
  const {
    interim: sttInterim,
    error: sttError,
    supported: sttSupported,
  } = useSpeechTranscript({
    enabled: webSpeechOn && status === "active" && micOn,
    lang: sttLang,
    onFinal: (text) => {
      // Not a chat message: a call speaks a line every few seconds and those
      // would bury what the two of them actually typed. The agent reads these
      // to keep the record current and to decide when to speak up.
      void fetch(`/api/calls/${roomId}/utterance`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ text }),
        // the last sentence often finalizes as the call is being torn down —
        // keepalive lets it outlive the page instead of dying with it
        keepalive: true,
      });
    },
  });

  // ---- controls ----
  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }
  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  const ctrl =
    "flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors";

  return (
    // h-screen (not h-full): the template.tsx .page-enter wrapper has auto
    // height, so percentage heights collapse; main is viewport-tall anyway
    <div className="flex h-screen" data-testid="call-view">
      <div className="relative flex-1 overflow-hidden bg-black">
        {/* remote video fills the stage once connected */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`h-full w-full object-cover ${remoteLive && status === "active" ? "" : "hidden"}`}
        />
        {/* pre-connect stage: my own preview + status line */}
        {!(remoteLive && status === "active") && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            {partner && <DmAvatar user={partner} size={72} />}
            <div className="text-lg font-medium text-white">
              {partner?.displayName ?? "…"}
            </div>
            <div className="text-sm text-white/70" data-testid="call-status">
              {mediaError ? (
                "Camera/mic blocked — allow access in the browser and call again"
              ) : (
                <>
                  {status === "ringing-out" && "Calling…"}
                  {status === "loading" && "Connecting…"}
                  {status === "active" && "Connecting…"}
                  {status === "declined" && "Declined"}
                  {status === "ended" && "Call ended"}
                </>
              )}
            </div>
          </div>
        )}
        {/* mid-call network blip — recovery runs underneath */}
        {reconnecting && status === "active" && (
          <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-sm text-white/90">
            Reconnecting…
          </div>
        )}
        {/* my PiP */}
        <video
          data-testid="call-pip"
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={`absolute bottom-5 right-5 w-44 -scale-x-100 rounded-lg border border-white/20 shadow-lg ${camOn ? "" : "hidden"}`}
        />
        {/* controls */}
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3">
          <button
            data-testid="call-mic"
            onClick={toggleMic}
            aria-label={micOn ? "Mute" : "Unmute"}
            className={`${ctrl} ${micOn ? "bg-white/20 hover:bg-white/30" : "bg-white text-black"}`}
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <button
            data-testid="call-cam"
            onClick={toggleCam}
            aria-label={camOn ? "Camera off" : "Camera on"}
            className={`${ctrl} ${camOn ? "bg-white/20 hover:bg-white/30" : "bg-white text-black"}`}
          >
            {camOn ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
          <button
            data-testid="call-end"
            onClick={() => leave("record")}
            aria-label="End call"
            className={`${ctrl} bg-red-500 hover:bg-red-600`}
          >
            <PhoneOff size={18} />
          </button>
        </div>
        {/* STT truth panel — silent failure made "is speech even running?"
            unanswerable; now the engine reports its state on the stage */}
        {/* hidden on the clean stage; ?debug=1 brings it back — real engine
            failures still surface regardless */}
        {webSpeechOn && status === "active" && (debugOn || !sttSupported || sttError) && (
          <div
            data-testid="call-stt-state"
            className="absolute left-4 top-4 max-w-[50%] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white/80"
          >
            {!sttSupported
              ? "STT unavailable"
              : sttError
                ? `STT error: ${sttError}`
                : "STT listening"}
          </div>
        )}
        {/* live caption — what the engine hears, as it hears it (the demo
            can SEE the speech land instead of trusting a tiny badge) */}
        {webSpeechOn && status === "active" && sttInterim && (
          <div
            data-testid="call-stt-caption"
            className="pointer-events-none absolute bottom-24 left-1/2 max-w-[70%] -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-lg font-medium leading-snug text-white shadow-lg"
          >
            {sttInterim}
          </div>
        )}
        {/* demo/test: one click = one canned utterance through the REAL
            pipeline (POST /utterance → agent whisper/summary) — no speech
            needed to exercise the flow */}
        {status === "active" && debugOn && (
          <button
            data-testid="call-mock-utterance"
            onClick={() => {
              const MOCKS = [
                "Do you remember our anniversary? It is on October tenth.",
                "We first met at the university library, do you remember?",
                "Let's plan a weekend date by the river, maybe watch the sunset.",
              ];
              const text = MOCKS[mockIdxRef.current++ % MOCKS.length];
              void fetch(`/api/calls/${roomId}/utterance`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-client-id": clientId },
                body: JSON.stringify({ text }),
              });
            }}
            className="absolute left-4 top-12 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-black/80"
          >
            Send mock utterance
          </button>
        )}
      </div>
      {/* the room's real chat rides along — same composer, same bubbles,
          @agent included; only the width changes */}
      <aside
        data-testid="call-chat-panel"
        className="w-[380px] flex-none border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#191919]"
      >
        <DmView roomId={roomId} variant="call" />
      </aside>
    </div>
  );
}
