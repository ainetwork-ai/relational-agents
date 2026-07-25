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
  load: (pageId: string) => Promise<void>;
  add: (pageId: string, body: string, blockId?: string | null) => Promise<PageComment | null>;
  reply: (pageId: string, parentId: string, body: string) => Promise<PageComment | null>;
  setResolved: (pageId: string, commentId: string, resolved: boolean) => Promise<void>;
  remove: (pageId: string, commentId: string) => Promise<void>;
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  byPage: {},

  load: async (pageId) => {
    const res = await fetch(`/api/pages/${pageId}/comments`).catch(() => null);
    if (!res?.ok) return;
    const { comments } = await res.json();
    set((s) => ({ byPage: { ...s.byPage, [pageId]: comments as PageComment[] } }));
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
    }));
    return comment as PageComment;
  },

  reply: async (pageId, parentId, body) => {
    // A reply inherits its parent's block anchor so the whole thread stays
    // pinned to the same block (Notion behaviour).
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
    }));
  },
}));
