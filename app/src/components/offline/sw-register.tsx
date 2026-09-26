"use client";

import { useEffect } from "react";
import { clearOfflineCaches } from "@/lib/offline/caches";

/** Registers public/sw.js, which keeps visited pages for offline use. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    (window as unknown as { __ainmemOffline?: unknown }).__ainmemOffline = { clearOfflineCaches };
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
