"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Sidebar ordering. "manual" is the stored position — what dragging sets. */
export type SidebarSort = "manual" | "alpha" | "edited";

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
  /** section-header sort preference, shared by Private and Teamspaces */
  sidebarSort: SidebarSort;
  setSidebarSort: (sort: SidebarSort) => void;
  /** fold every expanded row back up */
  collapseAll: () => void;
  /** live drop preview while dragging a sidebar page */
  dropHint: { targetId: string; zone: "before" | "inside" | "after" } | null;
  setDropHint: (hint: { targetId: string; zone: "before" | "inside" | "after" } | null) => void;
  /** center peek: a page opened OVER the current one instead of navigating to
   *  it. parentPageId is the destination the peek header names. */
  peek: { pageId: string; parentPageId: string | null } | null;
  openPeek: (pageId: string, parentPageId?: string | null) => void;
  closePeek: () => void;
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
      sidebarSort: "manual",
      setSidebarSort: (sidebarSort) => set({ sidebarSort }),
      collapseAll: () => set({ expanded: {} }),
      dropHint: null,
      setDropHint: (dropHint) => set({ dropHint }),
      peek: null,
      openPeek: (pageId, parentPageId = null) => set({ peek: { pageId, parentPageId } }),
      closePeek: () => set({ peek: null }),
    }),
    {
      name: "app-ui",
      partialize: (s) => ({
        expanded: s.expanded,
        sidebarCollapsed: s.sidebarCollapsed,
        sidebarSort: s.sidebarSort,
      }),
    }
  )
);
