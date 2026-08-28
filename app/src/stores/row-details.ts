"use client";

import { create } from "zustand";

/** Whether a row page's 속성 sidebar (세부 정보 보기) is open on the FULL page.
 * The original narrows the page's layout by the sidebar's 385px rather than
 * covering it — so the page column (page-view) needs to know, and the block
 * that owns the toggle lives two components down. */
export const DETAILS_SIDEBAR_WIDTH = 385;

interface RowDetailsState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useRowDetails = create<RowDetailsState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
