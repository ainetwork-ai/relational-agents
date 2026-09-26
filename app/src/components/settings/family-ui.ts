"use client";

// Shared by the Family names panel and the family tree canvas (docs/superpowers/plans/2026-09-26-ens-family-settings.md,
// Tasks 7 and 7b): the API's shapes, the controls' classes, and how a stopped run is explained.
import { useEffect, useState } from "react";
import type { T } from "@/i18n/translate";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { WalletSignatureError, toWalletError } from "@/lib/wallet/provider";
import { FamilyApiError } from "@/lib/wallet/ens-issue";

// ── shapes of GET /api/workspaces/[id]/ens ───────────────────────────────────────────────────────

export interface TreeNode {
  name: string;
  label: string;
  alias: string | null;
  relation: string | null;
  address: string | null;
  registry: string | null;
  /** the viewer may add a child or spouse under this person (admins whose wallet holds the roles) */
  canAdd?: boolean;
  children: TreeNode[];
}
export interface Candidate {
  userId: string;
  displayName: string;
  address: string;
}

// same controls as workspace-general-panel.tsx
export const INPUT =
  "h-7 rounded-md border border-[rgba(28,19,1,0.11)] bg-transparent px-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-600 dark:text-neutral-100";
export const BTN =
  "flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-[rgba(28,19,1,0.11)] px-2 text-sm text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700";
export const PRIMARY = "h-7 rounded-md bg-blue-500 px-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50";
export const MUTED = "text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400";

export const ENS_APP = "https://app.ens.dev";
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const txUrl = (hash: string) => `${SEPOLIA_EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${SEPOLIA_EXPLORER}/address/${address}`;
export const displayOf = (n: Pick<TreeNode, "alias" | "label">) => n.alias ?? n.label;

/** What to tell the admin when a run stops. `rejected`: the wallet's approval was declined (the tree
 *  card shows a short "Cancelled · Continue"); every stop can be continued. */
export function explain(err: unknown, t: T, account: string): { message: string; rejected: boolean } {
  if (err instanceof FamilyApiError) return { message: err.message, rejected: false };
  const w = err instanceof WalletSignatureError ? err : toWalletError(err);
  if (w.reason === "rejected") return { message: t("Cancelled — press Continue to pick up where you left off."), rejected: true };
  if (w.reason === "no-provider") return { message: t("MetaMask was not found in this browser."), rejected: false };
  if (w.message === "wrong-account") return { message: t("Switch MetaMask to {addr}, then press Continue.", { addr: short(account) }), rejected: false };
  const cause = w.cause as { name?: string } | undefined;
  if (cause?.name === "ChainMismatchError") return { message: t("Switch MetaMask to Sepolia, then press Continue."), rejected: false };
  return { message: t("It stopped: {msg}", { msg: w.message.split("\n")[0] }), rejected: false };
}

export function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
