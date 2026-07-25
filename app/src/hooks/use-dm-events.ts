"use client";

import { useEffect, useRef } from "react";
import { subscribeSse } from "@/lib/sse-share";
import type { DmUser } from "@/stores/dm-rooms";

export interface DmEvent {
  type: "dm-message" | "dm-room" | "dm-typing";
  roomId?: string;
  clientId: string | null;
  at: number;
  /** dm-typing이 입력 중인 사용자를 싣는다 */
  user?: DmUser;
}

/**
 * 내 DM 인박스(/api/dm/events) 구독. 스트림은 subscribeSse 풀로 공유되므로
 * 사이드바·DM 뷰가 동시에 써도 EventSource는 탭당 1개다.
 * hello(=초기 연결/재연결)는 onHello로 — 끊긴 사이 이벤트는 refetch로 복구.
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
