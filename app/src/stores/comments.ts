"use client";

import { create } from "zustand";
import type { PublicUser } from "@/lib/auth/public-user";

/** A comment as served to the client: the row plus its shaped author. */
export interface PageComment {
  id: string;
  pageId: string;
  blockId: string | null;
  parentId: string | null;
  authorId: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  author: PublicUser | null;
}

interface CommentsState {
  byPage: Record<string, PageComment[]>;
 // { [pageId]: n } for the rows of a database — what the table's title-cell
 // badge reads. Kept apart from byPage because the table wants a number for
 // twenty pages, not twenty threads.
  countByPage: Record<string, number>;
  load: (pageId: string) => Promise<void>;
  loadCounts: (databaseId: string) => Promise<void>;
  add: (pageId: string, body: string, blockId?: string | null) => Promise<PageComment | null>;
  reply: (pageId: string, parentId: string, body: string) => Promise<PageComment | null>;
  setResolved: (pageId: string, commentId: string, resolved: boolean) => Promise<void>;
  remove: (pageId: string, commentId: string) => Promise<void>;
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  byPage: {},
  countByPage: {},

  load: async (pageId) => {
    const res = await fetch(`/api/pages/${pageId}/comments`).catch(() => null);
    if (!res?.ok) return;
    const { comments } = await res.json();
    const list = comments as PageComment[];
    set((s) => ({
      byPage: { ...s.byPage, [pageId]: list },
 // the thread we just read is the truth for this page's badge
      countByPage: { ...s.countByPage, [pageId]: list.length },
    }));
  },

  loadCounts: async (databaseId) => {
    const res = await fetch(`/api/databases/${databaseId}/comment-counts`).catch(() => null);
    if (!res?.ok) return;
    const { counts } = await res.json();
    set((s) => ({ countByPage: { ...s.countByPage, ...(counts as Record<string, number>) } }));
  },

  add: async (pageId, body, blockId = null) => {
    const res = await fetch(`/api/pages/${pageId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, blockId }),
    });
    if (!res.ok) return null;
    const { comment } = await res.json();
    set((s) => ({
      byPage: {
        ...s.byPage,
        [pageId]: [...(s.byPage[pageId] ?? []), comment as PageComment],
      },
      countByPage: { ...s.countByPage, [pageId]: (s.countByPage[pageId] ?? 0) + 1 },
    }));
    return comment as PageComment;
  },

  reply: async (pageId, parentId, body) => {
 // A reply inherits its parent's block anchor so the whole thread stays
 // pinned to the same block.
    const parent = (get().byPage[pageId] ?? []).find((c) => c.id === parentId);
    const res = await fetch(`/api/pages/${pageId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, blockId: parent?.blockId ?? null, parentId }),
    });
    if (!res.ok) return null;
    const { comment } = await res.json();
    set((s) => ({
      byPage: {
        ...s.byPage,
        [pageId]: [...(s.byPage[pageId] ?? []), comment as PageComment],
      },
      countByPage: { ...s.countByPage, [pageId]: (s.countByPage[pageId] ?? 0) + 1 },
    }));
    return comment as PageComment;
  },

  setResolved: async (pageId, commentId, resolved) => {
 // optimistic
    set((s) => ({
      byPage: {
        ...s.byPage,
        [pageId]: (s.byPage[pageId] ?? []).map((c) =>
          c.id === commentId ? { ...c, resolved } : c
        ),
      },
    }));
    const res = await fetch(`/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    if (!res.ok) await get().load(pageId);
  },

  remove: async (pageId, commentId) => {
    const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => ({
      byPage: {
        ...s.byPage,
        [pageId]: (s.byPage[pageId] ?? []).filter((c) => c.id !== commentId),
      },
      countByPage: { ...s.countByPage, [pageId]: Math.max(0, (s.countByPage[pageId] ?? 1) - 1) },
    }));
  },
}));
