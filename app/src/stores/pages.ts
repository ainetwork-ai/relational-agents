"use client";

import { create } from "zustand";
import type { Page } from "@/lib/db/schema";

interface PagesState {
  pages: Record<string, Page>;
  /** derived once per pages change — 1600+ PageItems must not each rescan
 * the whole map (that made page creation take ~10s at scale) */
  roots: Page[];
  childrenOf: Map<string, Page[]>;
  favorites: Page[];
  byTeamspace: Map<string, Page[]>;
  archived: Record<string, Page>;
  loaded: boolean;
  load: () => Promise<void>;
  loadArchived: () => Promise<void>;
  createPage: (parentPageId?: string | null, teamspaceId?: string | null) => Promise<Page>;
  updatePage: (id: string, patch: Partial<Page>) => Promise<void>;
  archivePage: (id: string) => Promise<void>;
  restorePage: (id: string) => Promise<void>;
  deleteForever: (id: string) => Promise<void>;
}

const byPos = (a: Page, b: Page) => a.position - b.position;

/** A page renders at the root when it has no parent or its parent isn't loaded. */
const isRoot = (p: Page, pages: Record<string, Page>) =>
  !p.parentPageId || !pages[p.parentPageId];

/** Build the tree indexes in one O(N log N) pass. */
function derive(pages: Record<string, Page>) {
  const roots: Page[] = [];
  const childrenOf = new Map<string, Page[]>();
  const favorites: Page[] = [];
  const byTeamspace = new Map<string, Page[]>();
  for (const p of Object.values(pages)) {
    if (p.isFavorite) favorites.push(p);
    if (p.teamspaceId) {
      const t = byTeamspace.get(p.teamspaceId);
      if (t) t.push(p);
      else byTeamspace.set(p.teamspaceId, [p]);
    }
    if (isRoot(p, pages)) {
      roots.push(p);
    } else {
      const pid = p.parentPageId!; // non-root ⇒ parent id present (isRoot above)
      const arr = childrenOf.get(pid);
      if (arr) arr.push(p);
      else childrenOf.set(pid, [p]);
    }
  }
  roots.sort(byPos);
  favorites.sort(byPos);
  for (const arr of childrenOf.values()) arr.sort(byPos);
  for (const arr of byTeamspace.values()) arr.sort(byPos);
  return { roots, childrenOf, favorites, byTeamspace };
}

export const usePagesStore = create<PagesState>((set, get) => ({
  pages: {},
  roots: [],
  childrenOf: new Map(),
  favorites: [],
  byTeamspace: new Map(),
  archived: {},
  loaded: false,

  load: async () => {
    const res = await fetch("/api/pages").catch(() => null); // dev-server restarts drop connections
    if (!res?.ok) return;
    const { pages } = await res.json();
    const map: Record<string, Page> = {};
    for (const p of pages) map[p.id] = p;
    set({ pages: map, ...derive(map), loaded: true });
  },

  loadArchived: async () => {
    const res = await fetch("/api/pages?archived=1").catch(() => null);
    if (!res?.ok) return;
    const { pages } = await res.json();
    const map: Record<string, Page> = {};
    for (const p of pages) map[p.id] = p;
    set((s) => {
 // keep optimistic archives the server hasn't caught up to yet — the
 // archive DELETE and this fetch race under load (S014/S015): a page we
 // just trashed is gone from `pages` but may miss the server snapshot
      for (const [id, p] of Object.entries(s.archived)) {
        if (!map[id] && !s.pages[id]) map[id] = p;
      }
      return { archived: map };
    });
  },

  createPage: async (parentPageId = null, teamspaceId = null) => {
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentPageId, teamspaceId }),
    });
    const { page } = await res.json();
    set((s) => {
      const pages = { ...s.pages, [page.id]: page };
      return { pages, ...derive(pages) };
    });
    return page;
  },

  updatePage: async (id, patch) => {
 // optimistic — but never fabricate a partial entry for a page the store
 // hasn't loaded yet ({...undefined, ...patch} has NO id, and the next
 // caller reading it would PATCH /api/pages/undefined). The server
 // response below fills the real record either way.
    set((s) => {
      if (!s.pages[id]) return s;
      const pages = { ...s.pages, [id]: { ...s.pages[id], ...patch } as Page };
      return { pages, ...derive(pages) };
    });
    const res = await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const { page } = await res.json();
      set((s) => {
        const pages = { ...s.pages, [id]: page };
        return { pages, ...derive(pages) };
      });
    }
  },

  archivePage: async (id) => {
    const { pages } = get();
 // optimistic: drop the whole subtree from the live tree
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of Object.values(pages)) {
        if (p.parentPageId && doomed.has(p.parentPageId) && !doomed.has(p.id)) {
          doomed.add(p.id);
          grew = true;
        }
      }
    }
    set((s) => {
      const next = { ...s.pages };
      const archived = { ...s.archived };
      for (const pid of doomed) {
        if (next[pid]) {
          archived[pid] = { ...next[pid], isArchived: true };
          delete next[pid];
        }
      }
      return { pages: next, ...derive(next), archived };
    });
    await fetch(`/api/pages/${id}`, { method: "DELETE" });
  },

  restorePage: async (id) => {
    const res = await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isArchived: false }),
    });
    if (res.ok) {
 // subtree restore happens server-side; refetch both lists
      await Promise.all([get().load(), get().loadArchived()]);
    }
  },

  deleteForever: async (id) => {
 // destructive — wait for the server before dropping it from the UI
    const res = await fetch(`/api/pages/${id}?permanent=1`, { method: "DELETE" });
    if (!res.ok) return;
    set((s) => {
      const archived = { ...s.archived };
      delete archived[id];
      return { archived };
    });
  },
}));

/** Root-level pages sorted by position. */
export function selectRoots(pages: Record<string, Page>): Page[] {
  return Object.values(pages)
    .filter((p) => isRoot(p, pages))
    .sort(byPos);
}

/** Children of a page sorted by position. */
export function selectChildren(pages: Record<string, Page>, parentId: string): Page[] {
  return Object.values(pages)
    .filter((p) => p.parentPageId === parentId)
    .sort((a, b) => a.position - b.position);
}
