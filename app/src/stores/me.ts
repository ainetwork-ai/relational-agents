"use client";

import { create } from "zustand";
import { useEffect } from "react";
import type { PublicUser } from "@/lib/auth/public-user";

interface MeState {
  me: PublicUser | null;
  loaded: boolean;
  /** Fetches /api/auth/me once per tab; concurrent callers share the flight. */
  load: () => Promise<void>;
  /** Overwrite after a PATCH /api/auth/me so every avatar updates at once. */
  setMe: (user: PublicUser | null) => void;
}

let flight: Promise<void> | null = null;

/** The signed-in user, fetched once and shared by every consumer — the sidebar
 * profile chip, the page face pile, anything else that draws "me". One store
 * means one name and one photo everywhere, including right after an edit. */
export const useMeStore = create<MeState>((set) => ({
  me: null,
  loaded: false,
  load: () => {
    if (flight) return flight;
    flight = fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d: { user?: PublicUser | null }) => {
        set({ me: d.user ?? null, loaded: true });
      })
      .catch(() => {
        set({ loaded: true });
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  },
  setMe: (user) => set({ me: user, loaded: true }),
}));

/** Reads the shared current user, kicking off the one fetch if nobody has yet. */
export function useMe(): PublicUser | null {
  const me = useMeStore((s) => s.me);
  const loaded = useMeStore((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void useMeStore.getState().load();
  }, [loaded]);
  return me;
}
