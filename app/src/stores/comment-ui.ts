"use client";

import { create } from "zustand";

/** Which comment thread is open in the side panel. An anchor is either a
 * block id (a thread pinned to that block) or the sentinel PAGE_ANCHOR for
 * the page-level discussion. null = the panel is closed. 
 * where a comment opens beside its anchor rather than in a bottom list. */
export const PAGE_ANCHOR = "__page__";

interface CommentUiState {
  openAnchor: string | null;
  open: (anchor: string) => void;
  close: () => void;
  toggle: (anchor: string) => void;
}

export const useCommentUi = create<CommentUiState>((set, get) => ({
  openAnchor: null,
  open: (anchor) => set({ openAnchor: anchor }),
  close: () => set({ openAnchor: null }),
  toggle: (anchor) => set({ openAnchor: get().openAnchor === anchor ? null : anchor }),
}));
