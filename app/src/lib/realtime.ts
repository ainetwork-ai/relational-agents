import "server-only";
import type { PublicUser } from "@/lib/auth/public-user";

/**
 * In-process pub/sub for page-level realtime events, fanned out over SSE.
 * Single-process `next start` deployment — for multi-instance this would move
 * to Postgres LISTEN/NOTIFY, but the interface stays the same.
 *
 * Survives dev HMR module duplication via globalThis (aindrive pattern).
 */

/** A live cursor/presence marker for a collaborator on a page. */
export interface CursorInfo {
  label: string;
  color: string;
  blockId?: string;
  x?: number;
  y?: number;
}

export interface PageEvent {
  type:
    | "blocks"
    | "page"
    | "cursor"
    | "presence"
    | "dm-message"
    | "dm-room"
    | "dm-typing"
    // video-call signaling (notification-only like the rest — receivers GET /api/calls/{roomId})
    | "dm-call-ring"
    | "dm-call-cancel"
    | "dm-call-accept"
    | "dm-call-decline"
    | "dm-call-signal"
    | "dm-call-end";
  /** channel key — page id, database id, or DM inbox key (`dm-inbox:<userId>`) */
  pageId: string;
  /** originating editor instance — clients ignore their own echo */
  clientId: string | null;
  at: number;
  /** presence/cursor events carry the actor + their cursor */
  user?: PublicUser;
  cursor?: CursorInfo;
  /** target room of dm-* events. No bodies — receivers refetch (notification-only) */
  roomId?: string;
}

type Subscriber = (event: PageEvent) => void;

const KEY = Symbol.for("app.realtime.subscribers");

function subscribers(): Map<string, Set<Subscriber>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Set<Subscriber>>>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

export function subscribe(pageId: string, fn: Subscriber): () => void {
  const map = subscribers();
  let set = map.get(pageId);
  if (!set) {
    set = new Set();
    map.set(pageId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) map.delete(pageId);
  };
}

export function publish(event: PageEvent): void {
  const set = subscribers().get(event.pageId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {}
  }
}
