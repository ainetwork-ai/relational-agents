"use client";

/**
 * The sidebar's per-relation money state (GET /api/treasury/summary), shared by
 * every row that shows it: one poll for the whole sidebar however many
 * components subscribe. Polls every 30 s while the tab is visible, and on
 * window focus. Never blocks: until the first answer, and after any error,
 * the map is empty and rows render as they always did.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { TreasurySummaryRoom } from "@/lib/agent/treasury/summary";

export type { TreasurySummaryRoom };

const POLL_MS = 30_000;
const EMPTY: ReadonlyMap<string, TreasurySummaryRoom> = new Map();

let byRoom: ReadonlyMap<string, TreasurySummaryRoom> = EMPTY;
const listeners = new Set<() => void>();
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

function emit(next: ReadonlyMap<string, TreasurySummaryRoom>): void {
  byRoom = next;
  for (const l of listeners) l();
}

async function refresh(): Promise<void> {
  if (inflight || document.visibilityState !== "visible") return;
  inflight = true;
  try {
    const res = await fetch("/api/treasury/summary", { cache: "no-store" });
    if (!res.ok) throw new Error(`summary ${res.status}`);
    const body = (await res.json()) as { rooms?: TreasurySummaryRoom[] };
    emit(new Map((body.rooms ?? []).map((r) => [r.roomId, r])));
  } catch {
    // render nothing on error rather than a stale or partial state
    if (byRoom.size) emit(EMPTY);
  } finally {
    inflight = false;
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible") void refresh();
}

function start(): void {
  void refresh();
  timer = setInterval(() => void refresh(), POLL_MS);
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener("focus", onVisible);
  document.removeEventListener("visibilitychange", onVisible);
  emit(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** roomId → money state. */
export function useTreasurySummary(): ReadonlyMap<string, TreasurySummaryRoom> {
  const map = useSyncExternalStore(subscribe, () => byRoom, () => EMPTY);
  useEffect(() => {
    if (subscribers++ === 0) start();
    return () => {
      if (--subscribers === 0) stop();
    };
  }, []);
  return map;
}
