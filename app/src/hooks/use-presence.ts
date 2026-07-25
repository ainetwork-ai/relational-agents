"use client";

import { subscribeSse } from "@/lib/sse-share";
import { useEffect, useRef, useState } from "react";
import { newId } from "@/lib/compat";
import { caretRect } from "@/lib/editor/caret";
import type { PublicUser } from "@/lib/auth/public-user";
import type { CursorInfo } from "@/lib/realtime";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];
const HEARTBEAT_MS = 4_000;
const STALE_MS = 15_000;

export interface PresentClient {
  clientId: string;
  user: PublicUser;
  cursor?: CursorInfo;
  color: string;
  at: number;
}

export interface PresenceSelf {
  clientId: string;
  user: PublicUser | null;
  color: string;
}

interface RawPresence {
  clientId: string;
  user: PublicUser;
  cursor?: CursorInfo;
  at?: number;
}

function toClient(p: RawPresence): PresentClient {
  return {
    clientId: p.clientId,
    user: p.user,
    cursor: p.cursor,
    color: p.cursor?.color ?? "#3b82f6",
    at: p.at ?? Date.now(),
  };
}

/**
 * Per-tab presence: heartbeats this client's caret to the server every few
 * seconds (and on caret move), and collects OTHER clients' presence/cursor
 * events off the page SSE stream. Stale peers (>15s silent) are pruned.
 */
export function usePresence(pageId: string): {
  others: PresentClient[];
  self: PresenceSelf;
} {
  const [clientId] = useState(() => newId());
  const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [self, setSelf] = useState<PublicUser | null>(null);
  const [others, setOthers] = useState<Record<string, PresentClient>>({});
  // bridges the interval sender to the caret-move listener without resubscribing
  const sendRef = useRef<() => void>(() => {});

  // who am I (label for my caret + my face-pile avatar)
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => {
        if (alive) setSelf(d.user ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // seed with whoever is already present
  useEffect(() => {
    let alive = true;
    fetch(`/api/pages/${pageId}/presence`)
      .then((r) => (r.ok ? r.json() : { presences: [] }))
      .then((d: { presences?: RawPresence[] }) => {
        if (!alive) return;
        const seed: Record<string, PresentClient> = {};
        for (const p of d.presences ?? []) {
          if (p.clientId !== clientId) seed[p.clientId] = toClient(p);
        }
        setOthers((prev) => ({ ...seed, ...prev }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId, clientId]);

  // heartbeat sender (starts once we know our label)
  useEffect(() => {
    if (!self) return;
    let cancelled = false;
    const label = self.displayName;

    const cursorFor = (): CursorInfo => {
      const rect = caretRect();
      let blockId: string | undefined;
      const node = window.getSelection()?.anchorNode ?? null;
      const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      const be = el?.closest('[data-testid^="block-editable-"]');
      const tid = be?.getAttribute("data-testid");
      if (tid) blockId = tid.replace("block-editable-", "");
      return {
        label,
        color,
        blockId,
        x: rect ? Math.round(rect.left) : undefined,
        y: rect ? Math.round(rect.top) : undefined,
      };
    };

    const send = async () => {
      if (cancelled) return;
      try {
        await fetch(`/api/pages/${pageId}/presence`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientId, cursor: cursorFor() }),
        });
      } catch {}
    };
    sendRef.current = () => void send();

    void send();
    const iv = setInterval(() => void send(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(iv);
      sendRef.current = () => {};
    };
  }, [pageId, clientId, color, self]);

  // caret-move heartbeat — attach the listener ONLY while other clients are
  // present. When alone there's nobody to render our caret, so we do ZERO
  // per-keystroke work (the 4s interval above keeps the registry fresh). This
  // keeps the editor's typing path clean in the common single-user case.
  const hasOthers = Object.keys(others).length > 0;
  useEffect(() => {
    if (!hasOthers) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSel = () => {
      const gap = Date.now() - last;
      if (gap >= 300) {
        last = Date.now();
        sendRef.current();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          sendRef.current();
        }, 300 - gap);
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [hasOthers]);

  // collect others' presence/cursor events off the page SSE stream
  // (shared pool — see sse-share.ts; a second EventSource per tab helped
  // exhaust the browser's 6-per-host connection limit)
  useEffect(() => {
    return subscribeSse(`/api/pages/${pageId}/events`, (ev) => {
      try {
        const event = JSON.parse(ev.data) as {
          type?: string;
          clientId?: string | null;
          user?: PublicUser;
          cursor?: CursorInfo;
          at?: number;
        };
        if (event.type !== "presence" && event.type !== "cursor") return;
        if (!event.clientId || event.clientId === clientId || !event.user) return;
        const entry = toClient({
          clientId: event.clientId,
          user: event.user,
          cursor: event.cursor,
          at: event.at,
        });
        setOthers((prev) => ({ ...prev, [entry.clientId]: entry }));
      } catch {}
    });
  }, [pageId, clientId]);

  // prune stale peers
  useEffect(() => {
    const iv = setInterval(() => {
      setOthers((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, PresentClient> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.at <= STALE_MS) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 3_000);
    return () => clearInterval(iv);
  }, []);

  return {
    others: Object.values(others).sort((a, b) =>
      a.clientId.localeCompare(b.clientId)
    ),
    self: { clientId, user: self, color },
  };
}
