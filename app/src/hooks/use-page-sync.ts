"use client";

import { useEffect, useRef } from "react";
import { subscribeSse } from "@/lib/sse-share";

export interface RemotePageEvent {
  type: "blocks" | "page";
  pageId: string;
  clientId: string | null;
  at: number;
}

/**
 * Subscribes to /api/pages/:id/events. Calls onRemote for events from OTHER
 * clients only (echo suppression via clientId, like aindrive's origin tag).
 *
 * When shareToken is provided, it's appended as a query param for EventSource
 * (which cannot set custom headers). The events route accepts ?token= as
 * a fallback for x-share-token.
 */
export function usePageSync(
  pageId: string,
  clientId: string,
  onRemote: (event: RemotePageEvent) => void,
  shareToken?: string
) {
  const onRemoteRef = useRef(onRemote);
  useEffect(() => {
    onRemoteRef.current = onRemote;
  });

  useEffect(() => {
    const url = shareToken
      ? `/api/pages/${pageId}/events?token=${encodeURIComponent(shareToken)}`
      : `/api/pages/${pageId}/events`;
 // shared stream (sse-share): one EventSource per url across the whole
 // tab — per-hook streams exhausted the browser's per-host connection pool
    return subscribeSse(
      url,
      (ev) => {
        try {
          const event = JSON.parse(ev.data) as RemotePageEvent;
          if (event.clientId && event.clientId === clientId) return; // own echo
          onRemoteRef.current(event);
        } catch {}
      },
 // Initial sync on (re)connect — anything published between our SSR
 // snapshot and this subscription would otherwise be lost forever
 // (aindrive's sync-step-1 equivalent).
      () => {
        onRemoteRef.current({ type: "blocks", pageId, clientId: null, at: Date.now() });
      }
    );
  }, [pageId, clientId, shareToken]);
}
