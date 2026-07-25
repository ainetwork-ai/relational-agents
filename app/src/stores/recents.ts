"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RecentsState {
  /** Recently opened page ids, most-recent first. */
  ids: string[];
  record: (id: string) => void;
}

const CAP = 12;

/** Tracks recently visited pages for the Quick Find empty state. */
export const useRecentsStore = create<RecentsState>()(
  persist(
    (set) => ({
      ids: [],
      record: (id) =>
        set((s) => ({ ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, CAP) })),
    }),
    { name: "notion-recents" }
  )
);
