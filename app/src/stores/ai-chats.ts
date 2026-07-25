"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AiChat } from "@/lib/db/schema";

interface AiChatsState {
  chats: AiChat[];
  loaded: boolean;
  activeTab: "pages" | "chats";
  /** 미읽음만 보기 필터 (chats-unread-filter) */
  unreadOnly: boolean;
  /** 음소거된 채팅 id 집합 — ai_chat_mutes 미러 */
  mutedChatIds: Set<string>;
  /** 서버에 비고정 채팅이 더 있는지 (GET /api/ai/chats의 hasMore) */
  hasMore: boolean;
  setTab: (tab: "pages" | "chats") => void;
  toggleUnreadOnly: () => void;
  load: () => Promise<void>;
  /** 다음 페이지(비고정 채팅)를 불러와 목록 뒤에 이어붙인다 (chats-load-more). */
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
  /** 모든 채팅 hasUnread=false (POST /api/ai/chats/read-all) */
  markAllRead: () => Promise<void>;
  /** per-chat 음소거 토글 (POST/DELETE /api/ai/chats/[id]/mute) */
  setMuted: (id: string, muted: boolean) => Promise<void>;
}

/** 고정 먼저, 그다음 updatedAt desc — 목록/패널 렌더에서 공용으로 쓰는 정렬. */
export function sortChats(chats: AiChat[]): AiChat[] {
  return [...chats].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/** 미읽음 채팅 수 — 사이드바 Chats 탭 뱃지(chats-tab-unread-badge)용 셀렉터. */
export function unreadChatCount(chats: AiChat[]): number {
  return chats.filter((c) => c.hasUnread).length;
}

const DEFAULT_PAGE_SIZE = 30;

/**
 * GET /api/ai/chats의 limit — 기본 30. e2e 테스트가 결정론적으로 load-more를
 * 트리거할 수 있도록 `localStorage['ai-chats-page-size']`가 있으면 그 값을 쓴다.
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
    { name: "notion-ai-chats", partialize: (s) => ({ activeTab: s.activeTab }) }
  )
);
