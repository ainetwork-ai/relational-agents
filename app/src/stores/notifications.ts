"use client";

import { create } from "zustand";
import type { PublicUser } from "@/lib/auth/public-user";

/** A notification as served to the client: the row plus its actor + page title. */
export interface InboxNotification {
  id: string;
  userId: string;
  type: string; // 'mention' | 'comment' | 'invite'
  actorId: string | null;
  pageId: string | null;
  commentId: string | null;
  body: string;
  read: boolean;
  createdAt: string;
  actor: PublicUser | null;
  pageTitle: string | null;
}

interface NotificationsState {
  items: InboxNotification[];
  unreadCount: number;
  loaded: boolean;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  unreadCount: 0,
  loaded: false,

  load: async () => {
    const res = await fetch("/api/notifications").catch(() => null); // poll survives transient network loss
    if (!res?.ok) return;
    const data = await res.json();
    set({
      items: (data.notifications ?? []) as InboxNotification[],
      unreadCount: data.unreadCount ?? 0,
      loaded: true,
    });
  },

  markRead: async (id) => {
 // optimistic
    set((s) => {
      const items = s.items.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { items, unreadCount: items.filter((n) => !n.read).length };
    });
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  markAll: async () => {
    set((s) => ({
      items: s.items.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  },
}));
