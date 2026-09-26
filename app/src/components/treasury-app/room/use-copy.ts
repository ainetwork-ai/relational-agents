"use client";

/** Copying an address or a hash, with the copied/failed state it shows for a moment. */

import { useEffect, useState } from "react";

const SHOWN_MS = 1600;

/** The Clipboard API where the origin allows it; an insecure origin (a LAN address) copies through a selected textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // blocked by the browser: try the textarea below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(text: string): [CopyState, () => void] {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  return [state, () => void copyText(text).then((ok) => setState(ok ? "copied" : "failed"))];
}
