"use client";

import { create } from "zustand";

export interface TeamspaceLite {
  id: string;
  name: string;
  icon: string | null;
  description?: string;
  visibility?: string;
}

interface TeamspacesState {
  list: TeamspaceLite[];
  loaded: boolean;
  load: () => Promise<void>;
  /** re-fetch after a create/rename so the sidebar and breadcrumb agree */
  reload: (workspaceId?: string) => Promise<void>;
  byId: (id: string) => TeamspaceLite | undefined;
}

/**
 * The workspace's teamspaces, in one place.
 *
 * The sidebar used to fetch these into local state, which left the breadcrumb
 * with no way to name the teamspace a page belongs to — and would have meant two
 * copies drifting apart after a create. One store, one fetch.
 */
export const useTeamspacesStore = create<TeamspacesState>((set, get) => ({
  list: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    await get().reload();
  },
  reload: async (workspaceId?: string) => {
    const res = await fetch(workspaceId ? `/api/teamspaces?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/teamspaces");
    if (!res.ok) {
      set({ loaded: true });
      return;
    }
    const data = await res.json();
    set({ list: data.teamspaces ?? [], loaded: true });
  },
  byId: (id) => get().list.find((t) => t.id === id),
}));
