"use client";

import { create } from "zustand";
import { newId } from "@/lib/compat";

// 이 탭의 클라이언트 id — 뮤테이션 fetch에 x-client-id로 실어 자기 SSE echo를
// 서버·수신자가 구분하게 한다 (dm-view/사이드바 브릿지와 동일한 규약).
const TAB_CLIENT_ID = newId();

/** API가 내려주는 PublicUser의 클라이언트 표현 (날짜는 JSON 직렬화로 문자열). */
export interface DmUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

export interface DmLastMessage {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  hasAttachments: boolean;
}

export interface DmRoomSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  members: DmUser[];
  lastMessage: DmLastMessage | null;
  unreadCount: number;
}

/** 방 표시 이름: 지정 이름 > 나를 뺀 멤버 이름들 > 상대 없음 표시.
 *  self-DM 기능은 없으므로 "others 0명"은 상대가 모두 나간 방 → 중립 라벨. */
export function dmRoomLabel(room: DmRoomSummary, meId: string | null): string {
  if (room.name) return room.name;
  const others = room.members.filter((m) => m.id !== meId);
  if (others.length === 0) return "(No participants)";
  return others.map((m) => m.displayName).join(", ");
}

interface DmRoomsState {
  rooms: DmRoomSummary[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (memberIds: string[], name?: string) => Promise<DmRoomSummary>;
  /** local: 미읽음 배지 즉시 제거 (서버 read POST와 별개) */
  markReadLocal: (roomId: string) => void;
}

export const useDmRoomsStore = create<DmRoomsState>()((set) => ({
  rooms: [],
  loaded: false,

  load: async () => {
    const r = await fetch("/api/dm/rooms");
    if (!r.ok) return;
    const { rooms } = (await r.json()) as { rooms: DmRoomSummary[] };
    set({ rooms, loaded: true });
  },

  create: async (memberIds, name) => {
    const r = await fetch("/api/dm/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": TAB_CLIENT_ID },
      body: JSON.stringify({ memberIds, ...(name ? { name } : {}) }),
    });
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({ error: "Could not create" }));
      throw new Error(error);
    }
    const { room } = (await r.json()) as { room: DmRoomSummary };
    set((s) => ({ rooms: [room, ...s.rooms.filter((x) => x.id !== room.id)] }));
    return room;
  },

  markReadLocal: (roomId) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)),
    })),
}));

/** 전체 미읽음 합 — 사이드바 Chats 탭 배지용 셀렉터. */
export function totalDmUnread(rooms: DmRoomSummary[]): number {
  return rooms.reduce((n, r) => n + r.unreadCount, 0);
}
