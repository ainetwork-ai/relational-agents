"use client";

import { useEffect } from "react";
import { clearOfflineCaches } from "@/lib/offline/caches";
import { getTransactionQueue } from "@/lib/editor/transaction-queue";

const LAST_USER = "ainmem-last-user";

/**
 * Registers public/sw.js, which keeps visited pages for offline use, and tells
 * the save queue who is signed in. When someone else signed in on this browser
 * since the last visit — a logout that never ran, an expired session — the last
 * person's offline pages and signing keys are removed first (review I1/I2); their
 * unsent edits stay stored, unsent, until they are back.
 */
export function ServiceWorkerRegister({ userId }: { userId: string }) {
  useEffect(() => {
    (window as unknown as { __ainmemOffline?: unknown }).__ainmemOffline = { clearOfflineCaches };
    getTransactionQueue().setUser(userId);
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_USER);
    } catch {}
    const ready = last && last !== userId ? clearOfflineCaches() : Promise.resolve();
    void ready.then(() => {
      try {
        localStorage.setItem(LAST_USER, userId);
      } catch {}
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    });
  }, [userId]);
  return null;
}
