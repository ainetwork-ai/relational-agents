"use client";

import { useEffect, useState } from "react";

/**
 * What the browser needs to know about aindrive here — whether it is set up,
 * its web origin (so a pasted link can be recognised) and the drives offered —
 * fetched once per page load and shared.
 */
export interface AindriveInfo {
  configured: boolean;
  /** this person has connected their own aindrive account */
  connected: boolean;
  account: { email: string | null; name: string | null } | null;
  base: string | null;
  drives: { id: string; name: string; root: string; online?: boolean }[];
}

const NONE: AindriveInfo = { configured: false, connected: false, account: null, base: null, drives: [] };
let loaded: AindriveInfo | null = null;
let pending: Promise<AindriveInfo> | null = null;

export function loadAindriveInfo(fresh = false): Promise<AindriveInfo> {
  if (fresh) pending = null;
  pending ??= fetch("/api/aindrive")
    .then((r) => (r.ok ? r.json() : NONE))
    .then((d: Partial<AindriveInfo>) => {
      loaded = {
        configured: !!d.configured,
        connected: !!d.connected,
        account: d.account ?? null,
        base: d.base ?? null,
        drives: d.drives ?? [],
      };
      window.dispatchEvent(new Event(INFO_CHANGED));
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

const INFO_CHANGED = "aindrive:info-changed";

export function useAindriveInfo(): AindriveInfo | null {
  const [info, setInfo] = useState<AindriveInfo | null>(loaded);
  useEffect(() => {
    let alive = true;
    void loadAindriveInfo().then((i) => alive && setInfo(i));
    // connecting or disconnecting anywhere on the page updates every user of it
    const sync = () => alive && setInfo(loaded);
    window.addEventListener(INFO_CHANGED, sync);
    return () => {
      alive = false;
      window.removeEventListener(INFO_CHANGED, sync);
    };
  }, []);
  return info;
}

/**
 * Connects the person's own aindrive account from the browser session they
 * are signed in with there: opens aindrive's approval page in a popup, waits
 * for the approval, closes the popup. Resolves true once connected.
 */
export function connectAindrive(onStatus?: (s: "opening" | "waiting") => void): Promise<boolean> {
  return pairWithAindrive("/api/aindrive/account/connect", "/api/aindrive/account/poll", onStatus, true);
}

/** "Sign in with aindrive": the same approval, signing this browser in to the
 *  account behind the aindrive identity (made on first sign-in). */
export function signInWithAindrive(onStatus?: (s: "opening" | "waiting") => void): Promise<boolean> {
  return pairWithAindrive("/api/auth/aindrive/start", "/api/auth/aindrive/poll", onStatus, false);
}

async function pairWithAindrive(
  startUrl: string,
  pollUrl: string,
  onStatus: ((s: "opening" | "waiting") => void) | undefined,
  reloadInfo: boolean
): Promise<boolean> {
  onStatus?.("opening");
  // open the window inside the click, before any await — browsers block
  // popups opened later
  const popup = window.open("about:blank", "aindrive-connect", "width=520,height=680");
  const res = await fetch(startUrl, { method: "POST" });
  if (!res.ok) {
    popup?.close();
    return false;
  }
  const { pairingId, approveUrl, expiresAt } = (await res.json()) as {
    pairingId: string;
    approveUrl: string;
    expiresAt: number;
  };
  if (popup) popup.location.href = approveUrl;
  else window.open(approveUrl, "_blank", "noopener");
  onStatus?.("waiting");
  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await fetch(pollUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingId }),
    })
      .then((r) => r.json())
      .catch(() => ({ state: "pending" }));
    if (p.state === "connected") {
      popup?.close();
      if (reloadInfo) await loadAindriveInfo(true);
      return true;
    }
    if (p.state === "expired") break;
    // the person closed the window without approving
    if (popup?.closed) {
      // one last look: approving closes nothing on aindrive's side, so a
      // closed window right after approval is still a success
      const last = await fetch(pollUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairingId }),
      })
        .then((r) => r.json())
        .catch(() => ({}));
      if (last.state === "connected") {
        if (reloadInfo) await loadAindriveInfo(true);
        return true;
      }
      break;
    }
  }
  popup?.close();
  return false;
}

export async function disconnectAindrive(): Promise<void> {
  await fetch("/api/aindrive/account", { method: "DELETE" });
  await loadAindriveInfo(true);
}
