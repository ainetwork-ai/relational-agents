"use client";

import { useEffect, useState } from "react";

/**
 * What the browser needs to know about aindrive here — whether it is set up,
 * its web origin (so a pasted link can be recognised) and the drives offered —
 * fetched once per page load and shared.
 */
export interface AindriveInfo {
  configured: boolean;
  base: string | null;
  drives: { id: string; name: string; root: string }[];
}

const NONE: AindriveInfo = { configured: false, base: null, drives: [] };
let loaded: AindriveInfo | null = null;
let pending: Promise<AindriveInfo> | null = null;

export function loadAindriveInfo(): Promise<AindriveInfo> {
  pending ??= fetch("/api/aindrive")
    .then((r) => (r.ok ? r.json() : NONE))
    .then((d: Partial<AindriveInfo>) => {
      loaded = { configured: !!d.configured, base: d.base ?? null, drives: d.drives ?? [] };
      return loaded;
    })
    .catch(() => {
      pending = null; // try again next time
      return NONE;
    });
  return pending;
}

/** The last loaded info, for synchronous callers (a paste handler); null until loaded. */
export function aindriveInfoNow(): AindriveInfo | null {
  return loaded;
}

export function useAindriveInfo(): AindriveInfo | null {
  const [info, setInfo] = useState<AindriveInfo | null>(loaded);
  useEffect(() => {
    let alive = true;
    void loadAindriveInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
