"use client";

import { create } from "zustand";
import { newId } from "@/lib/compat";

// this tab's client id — sent as x-client-id on mutation fetches so server
// and receivers can tell our own SSE echo apart (same convention as the
// dm-view/sidebar bridge).
const TAB_CLIENT_ID = newId();

/** Client shape of the API's PublicUser (dates arrive JSON-serialized as strings). */
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

/** Room display name: explicit name > other members' names > no-partner
 * label. There is no self-DM, so "zero others" means everyone left → a
 * neutral label. */
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
  /** local: clear the unread badge immediately (independent of the server read POST) */
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

/** Total unread — selector for the sidebar Chats tab badge. */
export function totalDmUnread(rooms: DmRoomSummary[]): number {
  return rooms.reduce((n, r) => n + r.unreadCount, 0);
}
