import "server-only";

/**
 * In-memory store for live video-call signaling state, one call per DM room.
 * Calls are ephemeral (a dev-server restart drops them — acceptable), so no
 * table; survives dev HMR module duplication via globalThis, exactly like
 * lib/realtime.ts. Single-process deployment only.
 */

/** Opaque SDP blob ({ type, sdp }) — the server never inspects it. */
export interface CallSdp {
  type: string;
  sdp: string;
}

export interface CallState {
  roomId: string;
  /** Stable id for this call. Signaling state is ephemeral, but transcribed
   *  utterances outlive it — the record cites the call they came from. */
  callId: string;
  callerId: string;
  calleeId?: string;
  status: "ringing" | "active";
  offer?: CallSdp;
  answer?: CallSdp;
  startedAt: number;
  /** when the callee accepted — the call-duration clock (chat bubble) */
  acceptedAt?: number;
  /** last heartbeat from any participant — the liveness clock */
  beatAt?: number;
}

const KEY = Symbol.for("app.calls");

function calls(): Map<string, CallState> {
  const g = globalThis as unknown as Record<symbol, Map<string, CallState>>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/** A ringing call nobody answered within this window is dead — invite may reclaim it. */
export const RING_STALE_MS = 2 * 60 * 1000;

/** An active call whose participants stopped heartbeating is a ghost (a
 * crashed browser never sends the pagehide end) — invite may reclaim it. */
export const ACTIVE_STALE_MS = 45 * 1000;

export function getCall(roomId: string): CallState | null {
  return calls().get(roomId) ?? null;
}

/** Every live call — the ring-recovery sweep filters it down to "ringing
 *  for me" (a handful of entries at demo scale). */
export function listCalls(): CallState[] {
  return [...calls().values()];
}

export function setCall(state: CallState): void {
  calls().set(state.roomId, state);
}

export function deleteCall(roomId: string): void {
  calls().delete(roomId);
}
