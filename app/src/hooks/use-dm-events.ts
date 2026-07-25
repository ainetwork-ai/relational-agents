"use client";

import { useEffect, useRef } from "react";
import { subscribeSse } from "@/lib/sse-share";
import type { DmUser } from "@/stores/dm-rooms";

export interface DmEvent {
  type:
    | "dm-message"
    | "dm-room"
    | "dm-typing"
    | "dm-call-ring"
    | "dm-call-cancel"
    | "dm-call-accept"
    | "dm-call-decline"
    | "dm-call-signal"
    | "dm-call-end";
  roomId?: string;
  clientId: string | null;
  at: number;
  /** dm-typing and dm-call-ring carry the acting user */
  user?: DmUser;
}

/**
 * Subscribes to my DM inbox (/api/dm/events). The stream is shared through
 * the subscribeSse pool, so sidebar + DM view together still cost one
 * EventSource per tab. hello (= initial connect/reconnect) goes to onHello —
 * events missed while down are recovered by refetch.
 */
export function useDmEvents(onEvent: (event: DmEvent) => void, onHello?: () => void) {
  const onEventRef = useRef(onEvent);
  const onHelloRef = useRef(onHello);
  useEffect(() => {
    onEventRef.current = onEvent;
    onHelloRef.current = onHello;
  });

  useEffect(() => {
    return subscribeSse(
      "/api/dm/events",
      (ev) => {
        try {
          const event = JSON.parse(ev.data) as DmEvent;
          if (!event.type?.startsWith("dm-")) return;
          onEventRef.current(event);
        } catch {}
      },
      () => onHelloRef.current?.()
    );
  }, []);
}
