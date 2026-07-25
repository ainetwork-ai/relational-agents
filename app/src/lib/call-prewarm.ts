/**
 * Camera/mic pre-warm for incoming calls: acquiring the devices takes up to
 * ~1.5s and used to start only AFTER accept, sitting squarely on the
 * "Connecting…" critical path. The incoming-call card starts the capture
 * while the phone is still ringing; the call view adopts it on mount.
 * Survives dev HMR via globalThis, like lib/call-store.
 */

interface PrewarmedMedia {
  roomId: string;
  stream: MediaStream;
}

const KEY = Symbol.for("app.call-prewarm");

function slot(): { cur: PrewarmedMedia | null; pending: string | null } {
  const g = globalThis as unknown as Record<
    symbol,
    { cur: PrewarmedMedia | null; pending: string | null }
  >;
  if (!g[KEY]) g[KEY] = { cur: null, pending: null };
  return g[KEY];
}

export const CALL_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: true,
  audio: { echoCancellation: true, noiseSuppression: true },
};

/** Start capturing for this room's call (idempotent; a ring for a different
 *  room replaces the old warm stream). Failures are silent — the call view
 *  will retry getUserMedia itself and surface the error properly. */
export async function prewarmCallMedia(roomId: string): Promise<void> {
  const s = slot();
  if (s.cur?.roomId === roomId || s.pending === roomId) return;
  discardCallMedia();
  s.pending = roomId;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CALL_MEDIA_CONSTRAINTS);
    // the ring may have been declined/cancelled while we waited on the OS
    if (s.pending === roomId) s.cur = { roomId, stream };
    else stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* call view retries and reports */
  } finally {
    if (s.pending === roomId) s.pending = null;
  }
}

/** Hand the warm stream to the call view (single use). */
export function adoptCallMedia(roomId: string): MediaStream | null {
  const s = slot();
  if (s.cur?.roomId !== roomId) return null;
  const stream = s.cur.stream;
  s.cur = null;
  return stream;
}

/** Ring over without a call (decline/cancel/timeout) — release the devices. */
export function discardCallMedia(): void {
  const s = slot();
  s.pending = null;
  s.cur?.stream.getTracks().forEach((t) => t.stop());
  s.cur = null;
}
