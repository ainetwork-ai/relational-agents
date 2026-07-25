"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { newId } from "@/lib/compat";
import { useDmEvents } from "@/hooks/use-dm-events";
import { useSpeechTranscript } from "@/hooks/use-speech-transcript";
import { CallChatPanel } from "@/components/call/call-chat-panel";
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

/** Wait for non-trickle ICE: full SDP in one blob (host candidates gather in
 * ms on localhost); capped so a stall can't hang the call. */
function waitIceComplete(pc: RTCPeerConnection, capMs = 2000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, capMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const offerDoneRef = useRef(false); // caller: offer posted / callee: offer answered
  const answerDoneRef = useRef(false); // caller: answer applied
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
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const ensurePc = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    // STUN so srflx candidates exist — host-only works same-machine, but a
    // two-device demo needs at least a reflexive path
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const stream = await ensureLocalStream();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.ontrack = (ev) => {
      if (remoteVideoRef.current && ev.streams[0]) {
        remoteVideoRef.current.srcObject = ev.streams[0];
        setRemoteLive(true);
      }
    };
    pcRef.current = pc;
    return pc;
  }, [ensureLocalStream]);

  const teardown = useCallback(() => {
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
      if (call.status === "ringing") {
        void ensureLocalStream().catch(() => {});
        setStatus(iAmCaller ? "ringing-out" : "loading");
        return;
      }
      // active
      setStatus("active");
      if (iAmCaller) {
        if (!offerDoneRef.current) {
          offerDoneRef.current = true;
          const pc = await ensurePc();
          await pc.setLocalDescription(await pc.createOffer());
          await waitIceComplete(pc);
          await fetch(`/api/calls/${roomId}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-client-id": clientId },
            body: JSON.stringify({ action: "offer", sdp: pc.localDescription }),
          });
        }
        if (call.answer && !answerDoneRef.current) {
          answerDoneRef.current = true;
          const pc = await ensurePc();
          await pc.setRemoteDescription(call.answer as RTCSessionDescriptionInit);
        }
      } else if (call.offer && !offerDoneRef.current) {
        offerDoneRef.current = true;
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

  // ---- STT: my mic → the agent's ear (never the transcript) ----
  const { interim, supported: sttSupported } = useSpeechTranscript({
    enabled: status === "active" && micOn,
    onFinal: (text) => {
      // Not a chat message: a call speaks a line every few seconds and those
      // would bury what the two of them actually typed. The agent reads these
      // to keep the record current and to decide when to speak up.
      void fetch(`/api/calls/${roomId}/utterance`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ text }),
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
              {status === "ringing-out" && "Calling…"}
              {status === "loading" && "Connecting…"}
              {status === "active" && "Connecting…"}
              {status === "declined" && "Declined"}
              {status === "ended" && "Call ended"}
            </div>
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
        {!sttSupported && status === "active" && (
          <div className="absolute left-4 top-4 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80">
            STT unavailable
          </div>
        )}
      </div>
      <CallChatPanel roomId={roomId} meId={meId} members={members} interim={interim} />
    </div>
  );
}
