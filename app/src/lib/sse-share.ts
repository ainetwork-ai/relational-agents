"use client";

/**
 * Shared EventSource pool. HTTP/1.1 allows only ~6 connections per host, and
 * every open tab already needs streams for page sync, presence, and database
 * view sync — per-hook EventSources exhaust the pool and starve ALL fetches
 * (S424 post-mortem: PATCHes hung forever with 3 windows open). One stream
 * per URL, fanned out to any number of listeners, refcounted, with the
 * aindrive-style backoff reconnect.
 */

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

interface SharedStream {
  es: EventSource | null;
  refs: number;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  onMessage: Set<(ev: MessageEvent) => void>;
  onHello: Set<() => void>;
}

const pool = new Map<string, SharedStream>();

function connect(url: string, s: SharedStream) {
  if (s.closed) return;
  const es = new EventSource(url);
  s.es = es;
  es.onopen = () => {
    s.attempt = 0;
  };
  es.addEventListener("hello", () => {
    for (const fn of s.onHello) fn();
  });
  es.onmessage = (ev) => {
    for (const fn of s.onMessage) fn(ev);
  };
  es.onerror = () => {
    es.close();
    if (s.es === es) s.es = null;
    if (s.closed) return;
    const wait = RECONNECT_DELAYS_MS[Math.min(s.attempt, RECONNECT_DELAYS_MS.length - 1)];
    s.attempt++;
    s.timer = setTimeout(() => connect(url, s), wait);
  };
}

/** Subscribe to an SSE url; returns an unsubscribe. The underlying stream is
 *  shared across all subscribers of the same url. */
export function subscribeSse(
  url: string,
  onMessage: (ev: MessageEvent) => void,
  onHello?: () => void
): () => void {
  let s = pool.get(url);
  if (!s) {
    s = {
      es: null,
      refs: 0,
      attempt: 0,
      timer: null,
      closed: false,
      onMessage: new Set(),
      onHello: new Set(),
    };
    pool.set(url, s);
    connect(url, s);
  } else if (s.es && s.es.readyState === EventSource.OPEN && onHello) {
    // stream already live — the late subscriber still needs its initial sync
    queueMicrotask(onHello);
  }
  s.refs++;
  s.onMessage.add(onMessage);
  if (onHello) s.onHello.add(onHello);
  return () => {
    s.refs--;
    s.onMessage.delete(onMessage);
    if (onHello) s.onHello.delete(onHello);
    if (s.refs <= 0) {
      s.closed = true;
      if (s.timer) clearTimeout(s.timer);
      s.es?.close();
      pool.delete(url);
    }
  };
}
