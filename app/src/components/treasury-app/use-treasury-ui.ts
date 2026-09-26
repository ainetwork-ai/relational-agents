"use client";

/**
 * The per-browser switch for the new Treasury surfaces. Default ON.
 * `?treasury=v1` turns them off in this browser and remembers it in localStorage;
 * `?treasury=v2` turns them back on. Everything the treasury-app adds renders only
 * when this says "v2". The off side exists so an ETHGlobal recording can show the
 * screens as they were; remove the switch once those recordings are done.
 *
 * `?treasury=` also carries the World ID callback outcome (treasury-panel.tsx);
 * only the two values below are read here, so the two uses never collide.
 */

import { useEffect, useSyncExternalStore } from "react";

export const TREASURY_UI_STORAGE_KEY = "ainmem.treasury";
export const TREASURY_UI_PARAM = "treasury";
export type TreasuryUi = "v1" | "v2";

function isTreasuryUi(value: string | null): value is TreasuryUi {
  return value === "v1" || value === "v2";
}

function readUrlChoice(): TreasuryUi | null {
  const value = new URLSearchParams(window.location.search).get(TREASURY_UI_PARAM);
  return isTreasuryUi(value) ? value : null;
}

function readStoredChoice(): TreasuryUi | null {
  try {
    const value = window.localStorage.getItem(TREASURY_UI_STORAGE_KEY);
    return isTreasuryUi(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredChoice(choice: TreasuryUi): void {
  try {
    window.localStorage.setItem(TREASURY_UI_STORAGE_KEY, choice);
  } catch {
    // private window or blocked storage: the URL still decides this visit
  }
}

function clientSnapshot(): TreasuryUi {
  return readUrlChoice() ?? readStoredChoice() ?? "v2";
}

// null on the server and during hydration, so server HTML never disagrees with the client
function serverSnapshot(): TreasuryUi | null {
  return null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** "v1" | "v2" once mounted; null before hydration (render nothing switch-dependent yet). */
export function useTreasuryUi(): TreasuryUi | null {
  const choice = useSyncExternalStore<TreasuryUi | null>(subscribe, clientSnapshot, serverSnapshot);
  // persist an explicit URL choice so the switch survives navigation
  useEffect(() => {
    const fromUrl = readUrlChoice();
    if (fromUrl) writeStoredChoice(fromUrl);
  }, [choice]);
  return choice;
}

/** true only when the switch is known to be on. */
export function useTreasuryV2(): boolean {
  return useTreasuryUi() === "v2";
}
