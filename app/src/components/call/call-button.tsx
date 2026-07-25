"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Video } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { discardCallMedia, prewarmCallMedia } from "@/lib/call-prewarm";

/**
 * Starts a video call for a DM room. Two placements:
 *  - <CallButton roomId=…>  — DM room header (room already known)
 *  - <PageCallButton pageId=…> — record-page topbar; resolves the room via
 *    /api/calls/room-for-page and renders nothing when the page isn't a
 *    relationship record of mine.
 * Click → POST invite → navigate to /call/{roomId}; the call view takes it
 * from there ("Calling…" until the other side accepts).
 */
export function CallButton({ roomId }: { roomId: string }) {
  const router = useRouter();
  const show = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  async function startCall() {
    setBusy(true);
    // The callee warms its camera while the phone rings; the caller had no
    // equivalent and paid the ~1s device acquisition after navigation, with
    // the offer waiting behind it. The click is the earliest moment we know a
    // call is coming — and it is a user gesture, so the permission prompt
    // belongs here rather than after a route change.
    void prewarmCallMedia(roomId);
    try {
      const res = await fetch(`/api/calls/${roomId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "invite" }),
      });
      if (!res.ok && res.status !== 409) {
        discardCallMedia(); // no call to hand the camera to
        show("Could not start the call");
        return;
      }
      // 409 = a call is already live in this room — join it instead of ringing
      router.push(`/call/${roomId}`);
    } catch {
      discardCallMedia();
      show("Could not start the call");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      data-testid="call-button"
      onClick={() => void startCall()}
      disabled={busy}
      aria-label="Start video call"
      data-tip="Video call"
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 sm:px-2.5 dark:text-green-400 dark:hover:bg-green-950/40"
    >
      <Video size={14} /> <span className="hidden sm:inline">Call</span>
    </button>
  );
}

/** Record-page variant — hidden until the page resolves to one of my rooms. */
export function PageCallButton({ pageId }: { pageId: string }) {
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/calls/room-for-page/${pageId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.roomId) setRoomId(d.roomId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId]);

  if (!roomId) return null;
  return <CallButton roomId={roomId} />;
}
