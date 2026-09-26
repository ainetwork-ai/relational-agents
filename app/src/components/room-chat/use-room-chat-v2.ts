"use client";

/** The per-browser switch between the v1 room chat and RoomChatV2. Off by
 *  default; `?chat=v2` turns it on and remembers it in localStorage, `?chat=v1`
 *  turns it off again. Storage can throw (private mode, blocked site data), so
 *  every access is guarded and the URL alone still decides that visit. */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export const ROOM_CHAT_STORAGE_KEY = "ainmem.chat";

/** URL first, then what this browser remembered; anything else is v1. */
export function resolveRoomChatV2(param: string | null, stored: string | null): boolean {
  if (param === "v2") return true;
  if (param === "v1") return false;
  return stored === "v2";
}

export function useRoomChatV2(): boolean {
  const param = useSearchParams().get("chat");
  // false on the server and the first client render, so hydration always matches
  const [on, setOn] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      if (param === "v2" || param === "v1") localStorage.setItem(ROOM_CHAT_STORAGE_KEY, param);
      stored = localStorage.getItem(ROOM_CHAT_STORAGE_KEY);
    } catch {
      /* storage unavailable — the URL still decides this visit */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setOn(resolveRoomChatV2(param, stored));
  }, [param]);
  return on;
}
