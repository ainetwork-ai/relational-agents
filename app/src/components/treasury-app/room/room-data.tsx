"use client";

/**
 * One fetch of GET /api/treasury/[roomId] shared by the four Treasury tabs.
 * The shell (layout) owns it, so switching tabs neither refetches nor drops
 * the treasurer chat; it refreshes while the tab is visible, and a failed
 * refresh keeps the last good data on screen.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { TreasuryRoomResponse } from "./room-types";

// Same cadence as the room's treasury panel: approvals and executions show up while people watch.
const POLL_MS = 5000;

export type RoomLoad =
  | { kind: "loading" }
  | { kind: "error"; code: "forbidden" | "not-found" | "failed" }
  | { kind: "ready"; data: TreasuryRoomResponse; at: number };

interface RoomCtx {
  roomId: string;
  load: RoomLoad;
  reload: () => Promise<void>;
}

const Ctx = createContext<RoomCtx | null>(null);

function errorCode(status: number): "forbidden" | "not-found" | "failed" {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 400 || status === 404) return "not-found";
  return "failed";
}

export function TreasuryRoomProvider({ roomId, children }: { roomId: string; children: ReactNode }) {
  const [load, setLoad] = useState<RoomLoad>({ kind: "loading" });
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/treasury/${encodeURIComponent(roomId)}`, { cache: "no-store" });
      if (!res.ok) {
        const code = errorCode(res.status);
        setLoad((prev) => (prev.kind === "ready" && code === "failed" ? prev : { kind: "error", code }));
        return;
      }
      const data = (await res.json()) as TreasuryRoomResponse;
      setLoad({ kind: "ready", data, at: Date.now() });
    } catch {
      setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "error", code: "failed" }));
    } finally {
      inFlight.current = false;
    }
  }, [roomId]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  return <Ctx.Provider value={{ roomId, load, reload }}>{children}</Ctx.Provider>;
}

export function useTreasuryRoom(): RoomCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTreasuryRoom outside TreasuryRoomProvider");
  return ctx;
}

/** The loaded data; tabs render only inside the shell's ready state, so this never sees loading. */
export function useTreasuryRoomData(): { roomId: string; data: TreasuryRoomResponse; at: number; reload: () => Promise<void> } {
  const { roomId, load, reload } = useTreasuryRoom();
  if (load.kind !== "ready") throw new Error("useTreasuryRoomData before the treasury loaded");
  return { roomId, data: load.data, at: load.at, reload };
}
