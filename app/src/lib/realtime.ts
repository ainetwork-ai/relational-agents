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
  type: "blocks" | "page" | "cursor" | "presence" | "dm-message" | "dm-room" | "dm-typing";
  /** 채널 키 — 페이지 id, 데이터베이스 id, 또는 DM 인박스 키(`dm-inbox:<userId>`) */
  pageId: string;
  /** originating editor instance — clients ignore their own echo */
  clientId: string | null;
  at: number;
  /** presence/cursor events carry the actor + their cursor */
  user?: PublicUser;
  cursor?: CursorInfo;
  /** dm-* 이벤트의 대상 방. 본문은 싣지 않는다 — 수신자는 refetch (알림 전용) */
  roomId?: string;
}

type Subscriber = (event: PageEvent) => void;

const KEY = Symbol.for("notion.realtime.subscribers");

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
