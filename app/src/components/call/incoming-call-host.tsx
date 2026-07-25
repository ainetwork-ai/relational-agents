"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Phone, PhoneOff } from "lucide-react";
import { useDmEvents } from "@/hooks/use-dm-events";
import { DmAvatar } from "@/components/dm/dm-avatar";
import type { DmUser } from "@/stores/dm-rooms";

const RING_TIMEOUT_MS = 30_000;

/** Classic dual-tone ring (ported from videocall/public/index.html) — WebAudio
 * synth, no asset. Fails silently when autoplay policy keeps the context
 * suspended (fresh tab, no prior gesture): the visual card still shows. */
function startRingtone(): (() => void) | null {
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
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.setValueAtTime(0, t + 1.2);
    };
    beep();
    const iv = setInterval(beep, 3000);
    return () => {
      clearInterval(iv);
      void ctx.close();
    };
  } catch {
    return null;
  }
}

interface Ringing {
  roomId: string;
  caller: DmUser;
}

/**
 * Global incoming-call popup — mounted once in the (app) layout, listening on
 * the same per-user SSE inbox as the sidebar. dm-call-ring → confirm via
 * GET /api/calls/{roomId} (events are notification-only), then show the
 * top-right card. Accept navigates into /call/{roomId}; the caller learns the
 * answer from the dm-call-accept/decline event.
 */
export function IncomingCallHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [ringing, setRinging] = useState<Ringing | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // who am I — the ring event carries the CALLER, and my own outgoing ring
  // must never pop as an incoming call on my other surfaces
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.user?.id) setMeId(d.user.id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function clear() {
    setRinging(null); // the ringtone/timer live in the effect below — its cleanup stops them
  }

  // The ringtone is an EFFECT of the ringing state, never started inside a
  // state updater: StrictMode double-invokes updaters, and a second oscillator
  // started there overwrote the stop handle — the first tone rang forever,
  // through accept, decline and end alike.
  useEffect(() => {
    if (!ringing) return;
    stopRingRef.current = startRingtone();
    timerRef.current = setTimeout(() => setRinging(null), RING_TIMEOUT_MS);
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [ringing]);

  // entering the call room makes the card moot — and the ring can land a
  // beat BEFORE the caller's own navigation to /call, so this also kills
  // the self-ring that slipped in during that gap (stuck ringtone bug)
  useEffect(() => {
    if (ringing && pathname.startsWith("/call/")) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, ringing]);

  useDmEvents((event) => {
    if (!event.roomId) return;
    if (event.type === "dm-call-ring") {
      const caller = event.user;
      const roomId = event.roomId;
      // my own outgoing ring, already in a call view, or already showing one
      if (!caller || pathname.startsWith("/call/")) return;
      if (meId !== null && caller.id === meId) return;
      void fetch(`/api/calls/${roomId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.call?.status !== "ringing" || d.call.callerId !== caller.id) return;
          // pure updater — all side effects live in the ringing effect
          setRinging((cur) => cur ?? { roomId, caller });
        });
      return;
    }
    if (
      (event.type === "dm-call-cancel" ||
        event.type === "dm-call-accept" ||
        event.type === "dm-call-decline" ||
        event.type === "dm-call-end") &&
      ringing?.roomId === event.roomId
    )
      clear();
  });

  // ringtone/timer must not leak across route unmounts
  useEffect(() => () => clear(), []);

  async function answer(action: "accept" | "decline") {
    if (!ringing) return;
    const { roomId } = ringing;
    clear();
    await fetch(`/api/calls/${roomId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    if (action === "accept") router.push(`/call/${roomId}`);
  }

  if (!ringing) return null;
  return (
    <div
      data-testid="incoming-call"
      className="popover-anim fixed right-4 top-4 z-[70] flex w-80 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
    >
      <DmAvatar user={ringing.caller} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{ringing.caller.displayName}</div>
        <div className="text-xs text-neutral-500">Incoming video call…</div>
      </div>
      <button
        data-testid="incoming-decline"
        onClick={() => void answer("decline")}
        aria-label="Decline"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
      >
        <PhoneOff size={16} />
      </button>
      <button
        data-testid="incoming-accept"
        onClick={() => void answer("accept")}
        aria-label="Accept"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600"
      >
        <Phone size={16} />
      </button>
    </div>
  );
}
