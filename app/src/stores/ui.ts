"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  expanded: Record<string, boolean>;
  toggleExpanded: (pageId: string) => void;
  expand: (pageId: string) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  trashOpen: boolean;
  setTrashOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  /** live drop preview while dragging a sidebar page */
  dropHint: { targetId: string; zone: "before" | "inside" | "after" } | null;
  setDropHint: (hint: { targetId: string; zone: "before" | "inside" | "after" } | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      expanded: {},
      toggleExpanded: (pageId) =>
        set((s) => ({ expanded: { ...s.expanded, [pageId]: !s.expanded[pageId] } })),
      expand: (pageId) =>
        set((s) => ({ expanded: { ...s.expanded, [pageId]: true } })),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      trashOpen: false,
      setTrashOpen: (trashOpen) => set({ trashOpen }),
      searchOpen: false,
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      dropHint: null,
      setDropHint: (dropHint) => set({ dropHint }),
    }),
    {
      name: "notion-ui",
      partialize: (s) => ({
        expanded: s.expanded,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
);
