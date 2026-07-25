"use client";

import { v4 as uuidv4 } from "uuid";

/**
 * Secure-context-safe wrappers. http://<lan-ip> is NOT a secure context, so
 * crypto.randomUUID / navigator.clipboard are undefined there. Direct use of
 * those APIs in src/ is banned by harness/verify.sh — always go through here.
 */

export function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : uuidv4();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
 // writeText rejects with NotAllowedError ("Document is not focused")
 // when devtools or a just-opened tab holds focus — reclaim it first,
 // and fall through to the textarea path if the write still fails.
      if (!document.hasFocus()) window.focus();
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus(); // execCommand("copy") also needs a focused document
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Resolve a port-relative URL (":3111/path") against the current host, so
 * sibling services work over localhost tunnels and LAN alike. Absolute and
 * path-relative URLs pass through unchanged. */
export function resolveAppUrl(url: string): string {
  return /^:\d+/.test(url)
    ? `${window.location.protocol}//${window.location.hostname}${url}`
    : url;
}
