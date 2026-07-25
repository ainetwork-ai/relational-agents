"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AiChat } from "@/lib/db/schema";

interface AiChatsState {
  chats: AiChat[];
  loaded: boolean;
  activeTab: "pages" | "chats";
  /** unread-only filter (chats-unread-filter) */
  unreadOnly: boolean;
  /** muted chat id set — mirrors ai_chat_mutes */
  mutedChatIds: Set<string>;
  /** whether more unpinned chats exist server-side (hasMore from GET /api/ai/chats) */
  hasMore: boolean;
  setTab: (tab: "pages" | "chats") => void;
  toggleUnreadOnly: () => void;
  load: () => Promise<void>;
  /** load the next page (unpinned chats) and append it (chats-load-more). */
  loadMore: () => Promise<void>;
  create: (opts?: { title?: string; agentName?: string }) => Promise<AiChat>;
  patch: (
    id: string,
    patch: Partial<Pick<AiChat, "title" | "icon" | "isFavorite" | "isPinned">> & { markRead?: boolean }
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** local: mark a chat read (clears the blue dot without a refetch) */
  markReadLocal: (id: string) => void;
  bump: (id: string) => void;
  /** hasUnread=false across all chats (POST /api/ai/chats/read-all) */
  markAllRead: () => Promise<void>;
  /** per-chat mute toggle (POST/DELETE /api/ai/chats/[id]/mute) */
  setMuted: (id: string, muted: boolean) => Promise<void>;
}

/** Pinned first, then updatedAt desc — the sort shared by list/panel renders. */
export function sortChats(chats: AiChat[]): AiChat[] {
  return [...chats].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/** Unread chat count — selector for the sidebar Chats tab badge (chats-tab-unread-badge). */
export function unreadChatCount(chats: AiChat[]): number {
  return chats.filter((c) => c.hasUnread).length;
}

const DEFAULT_PAGE_SIZE = 30;

/**
 * The limit for GET /api/ai/chats — default 30. Honors
 * `localStorage['ai-chats-page-size']` so e2e can trigger load-more
 * deterministically.
 */
function getPageSize(): number {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem("ai-chats-page-size") : null;
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export const useAiChatsStore = create<AiChatsState>()(
  persist(
    (set, get) => ({
      chats: [],
      loaded: false,
      activeTab: "pages",
      unreadOnly: false,
      mutedChatIds: new Set<string>(),
      hasMore: false,
      setTab: (activeTab) => set({ activeTab }),
      toggleUnreadOnly: () => set((s) => ({ unreadOnly: !s.unreadOnly })),

      load: async () => {
        const r = await fetch(`/api/ai/chats?limit=${getPageSize()}`);
        if (!r.ok) return;
        const { chats, mutedChatIds, hasMore } = (await r.json()) as {
          chats: AiChat[];
          mutedChatIds?: string[];
          hasMore?: boolean;
        };
        set({ chats, mutedChatIds: new Set(mutedChatIds ?? []), hasMore: hasMore ?? false, loaded: true });
      },

      loadMore: async () => {
        const { chats, hasMore } = get();
        if (!hasMore) return;
        const lastUnpinned = [...chats].reverse().find((c) => !c.isPinned);
        if (!lastUnpinned) return;
        const before = new Date(lastUnpinned.updatedAt).toISOString();
        const r = await fetch(`/api/ai/chats?limit=${getPageSize()}&before=${encodeURIComponent(before)}`);
        if (!r.ok) return;
        const { chats: nextChats, mutedChatIds, hasMore: nextHasMore } = (await r.json()) as {
          chats: AiChat[];
          mutedChatIds?: string[];
          hasMore?: boolean;
        };
        set((s) => ({
          chats: [...s.chats, ...nextChats],
          mutedChatIds: new Set([...s.mutedChatIds, ...(mutedChatIds ?? [])]),
          hasMore: nextHasMore ?? false,
        }));
      },

      create: async (opts) => {
        const r = await fetch("/api/ai/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(opts ?? {}),
        });
        const { chat } = (await r.json()) as { chat: AiChat };
        set((s) => ({ chats: [chat, ...s.chats] }));
        return chat;
      },

      patch: async (id, patch) => {
 // optimistic
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...("title" in patch && patch.title !== undefined ? { title: patch.title } : {}),
                  ...("icon" in patch ? { icon: patch.icon ?? null } : {}),
                  ...("isFavorite" in patch && patch.isFavorite !== undefined
                    ? { isFavorite: patch.isFavorite }
                    : {}),
                  ...("isPinned" in patch && patch.isPinned !== undefined
                    ? { isPinned: patch.isPinned }
                    : {}),
                  ...(patch.markRead ? { hasUnread: false } : {}),
                }
              : c
          ),
        }));
        await fetch(`/api/ai/chats/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
      },

      remove: async (id) => {
        set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
        await fetch(`/api/ai/chats/${id}`, { method: "DELETE" });
      },

      markReadLocal: (id) =>
        set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, hasUnread: false } : c)) })),

      bump: (id) =>
        set((s) => {
          const c = s.chats.find((x) => x.id === id);
          if (!c) return {};
          const rest = s.chats.filter((x) => x.id !== id);
          return { chats: [{ ...c, updatedAt: new Date() as unknown as AiChat["updatedAt"] }, ...rest] };
        }),

      markAllRead: async () => {
        set((s) => ({ chats: s.chats.map((c) => (c.hasUnread ? { ...c, hasUnread: false } : c)) }));
        await fetch("/api/ai/chats/read-all", { method: "POST" });
      },

      setMuted: async (id, muted) => {
        set((s) => {
          const next = new Set(s.mutedChatIds);
          if (muted) next.add(id);
          else next.delete(id);
          return { mutedChatIds: next };
        });
        await fetch(`/api/ai/chats/${id}/mute`, { method: muted ? "POST" : "DELETE" });
      },
    }),
    { name: "ai-chats", partialize: (s) => ({ activeTab: s.activeTab }) }
  )
);
