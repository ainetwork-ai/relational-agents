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

interface Slot {
  cur: PrewarmedMedia | null;
  pending: string | null;
  /** the in-flight acquisition, so an adopter that arrives mid-warm waits for
   *  it instead of opening the camera a second time */
  inflight: Promise<void> | null;
}

function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot>;
  if (!g[KEY]) g[KEY] = { cur: null, pending: null, inflight: null };
  return g[KEY];
}

export const CALL_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: true,
  audio: { echoCancellation: true, noiseSuppression: true },
};

/** Start capturing for this room's call (idempotent; a ring for a different
 *  room replaces the old warm stream). Failures are silent — the call view
 *  will retry getUserMedia itself and surface the error properly. */
export function prewarmCallMedia(roomId: string): Promise<void> {
  const s = slot();
  if (s.cur?.roomId === roomId) return Promise.resolve();
  if (s.pending === roomId) return s.inflight ?? Promise.resolve();
  discardCallMedia();
  s.pending = roomId;
  const run = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CALL_MEDIA_CONSTRAINTS);
      // the ring may have been declined/cancelled while we waited on the OS
      if (s.pending === roomId) s.cur = { roomId, stream };
      else stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* call view retries and reports */
    } finally {
      if (s.pending === roomId) {
        s.pending = null;
        s.inflight = null;
      }
    }
  })();
  s.inflight = run;
  return run;
}

/** Hand the warm stream to the call view (single use).
 *
 * The caller pre-warms on the click that starts the call, so the call view
 * routinely arrives while the devices are still being acquired. Awaiting the
 * in-flight warm is what keeps that from becoming a second getUserMedia whose
 * winner is never adopted — that stream had nobody to stop it, and the camera
 * stayed lit for the rest of the session. */
export async function adoptCallMedia(roomId: string): Promise<MediaStream | null> {
  const s = slot();
  if (s.pending === roomId && s.inflight) await s.inflight;
  if (s.cur?.roomId !== roomId) return null;
  const stream = s.cur.stream;
  s.cur = null;
  return stream;
}

/** Ring over without a call (decline/cancel/timeout) — release the devices. */
export function discardCallMedia(): void {
  const s = slot();
  s.pending = null;
  s.inflight = null; // an acquisition still in flight stops itself: its roomId no longer matches
  s.cur?.stream.getTracks().forEach((t) => t.stop());
  s.cur = null;
}
