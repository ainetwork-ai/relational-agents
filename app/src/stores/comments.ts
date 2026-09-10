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
 // files on the comment. The client never sees a storage url — it addresses
 // bytes by id through /api/files/<id>/{stream,download}.
  attachments?: {
    id: string;
    name: string;
    size?: number;
    mimeType?: string;
    width?: number;
    height?: number;
  }[];
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
  add: (
    pageId: string,
    body: string,
    blockId?: string | null,
   // what the upload returned; the server turns these into file rows
    attachments?: { url: string; name: string; size?: number; mimeType?: string }[],
   // who the composer actually picked from the @ menu. A plain body carries no
   // `data-mention-*` markup, so the server cannot find its mentions by reading
   // the text — it is told. Omitted by callers that have no menu; the shape
   // stays what it was for them.
    mentionIds?: string[]
  ) => Promise<PageComment | null>;
  reply: (
    pageId: string,
    parentId: string,
    body: string,
    mentionIds?: string[]
  ) => Promise<PageComment | null>;
  setResolved: (pageId: string, commentId: string, resolved: boolean) => Promise<void>;
  /** Delete one comment (the server allows only its author). Returns false when
   * the server refused, so the caller can say so instead of doing nothing. */
  remove: (pageId: string, commentId: string) => Promise<boolean>;
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

  add: async (pageId, body, blockId = null, attachments = [], mentionIds = []) => {
    const res = await fetch(`/api/pages/${pageId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, blockId, attachments, mentionIds }),
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

  reply: async (pageId, parentId, body, mentionIds = []) => {
 // A reply inherits its parent's block anchor so the whole thread stays
 // pinned to the same block.
    const parent = (get().byPage[pageId] ?? []).find((c) => c.id === parentId);
    const res = await fetch(`/api/pages/${pageId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, blockId: parent?.blockId ?? null, parentId, mentionIds }),
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
    const res = await fetch(`/api/comments/${commentId}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return false;
 // only this row goes: Notion keeps a deleted head's replies and promotes the
 // next one (measured 2026-09-10), and the clients render a reply whose parent
 // is gone as its own thread
    set((s) => {
      const list = s.byPage[pageId] ?? [];
      const next = list.filter((c) => c.id !== commentId);
      return {
        byPage: { ...s.byPage, [pageId]: next },
 // recount from the list we now hold rather than decrementing a number that
 // may have come from the database's bulk count
        countByPage: { ...s.countByPage, [pageId]: next.length },
      };
    });
    return true;
  },
}));
