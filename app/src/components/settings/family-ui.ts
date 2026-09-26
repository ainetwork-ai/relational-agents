"use client";

// Shared by the Family names panel and the family tree canvas (docs/superpowers/plans/2026-09-26-ens-family-settings.md,
// Tasks 7 and 7b): the API's shapes, the controls' classes, and how a stopped run is explained.
import { useEffect, useState } from "react";
import type { T } from "@/i18n/translate";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { WalletSignatureError, toWalletError } from "@/lib/wallet/provider";
import { FamilyApiError } from "@/lib/wallet/ens-issue";
import type { MetaMaskFailure } from "@/lib/wallet/metamask-login";

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

/** A server refusal (FamilyApiError.reason, or the `reason` of a failed GET) as text for the admin.
 *  Unknown reasons get a generic line; the server's English text only goes to the console. */
export function apiReasonText(reason: string | undefined, t: T, raw?: string): string {
  switch (reason) {
    case "no-wallet":
      return t("Log in with your wallet first.");
    case "chain-unavailable":
      return t("Could not reach Sepolia right now. Try again in a moment.");
    case "exists":
      return t("This workspace already has a family name.");
    case "reserved":
      return t("Someone in this app is registering this name right now");
    case "taken":
      return t("This name was just registered by someone else.");
    case "not-yours":
      return t("This wallet does not own the name with its family registry.");
    case "no-from-block":
      return t("This browser lost track of the family registry. Cancel and start again.");
  }
  if (raw) console.warn("[family names]", reason, raw);
  return t("The server refused this step. Try again in a moment.");
}

/** Why logging in with the wallet failed (metamask-login's `reason`), in plain words; the English text only to the console. */
export function linkFailureText(reason: MetaMaskFailure, t: T, raw: string): string {
  switch (reason) {
    case "no-wallet":
      return t("Install MetaMask to manage family names.");
    case "no-account":
      return t("MetaMask has no account to connect.");
    case "rejected":
      return t("Login was cancelled.");
    case "no-challenge":
    case "invalid-signature":
      return t("The signature could not be checked. Try again.");
    case "taken":
      return t("This wallet is already used by another account. Log in to that account, or choose another wallet in MetaMask.");
    case "has-other":
      return t("This wallet doesn't have permission to manage this family.");
    case "changed":
      return t("This account's wallet changed meanwhile. Try again.");
    case "network":
      return t("Could not reach the server. Check your connection and try again.");
  }
  console.warn("[family names] wallet login:", raw);
  return t("Login failed. Try again.");
}

/** What to tell the admin when a run stops. `rejected`: the wallet's approval was declined (the tree
 *  card shows a short "Cancelled · Continue"); every stop can be continued. Server refusals are
 *  translated by reason (apiReasonText); a wallet's own English message only goes to the console. */
export function explain(err: unknown, t: T): { message: string; rejected: boolean } {
  if (err instanceof FamilyApiError) return { message: apiReasonText(err.reason, t, err.message), rejected: false };
  const w = err instanceof WalletSignatureError ? err : toWalletError(err);
  if (w.reason === "rejected") return { message: t("Cancelled — press Continue to pick up where you left off."), rejected: true };
  if (w.reason === "no-provider") return { message: t("MetaMask was not found in this browser."), rejected: false };
  if (w.reason === "no-account") return { message: t("MetaMask has no account to connect."), rejected: false };
  if (w.message === "wrong-account") return { message: t("Choose your wallet in MetaMask, then press Continue."), rejected: false };
  const cause = w.cause as { name?: string } | undefined;
  if (cause?.name === "ChainMismatchError") return { message: t("Switch MetaMask to Sepolia, then press Continue."), rejected: false };
  console.warn("[family names] run stopped:", w.message, w.cause);
  return { message: t("It stopped before finishing. Press Continue to try again."), rejected: false };
}

/** A USDC amount as the admin reads it: 2 decimals (the base rate is priced per second, so
 *  8.000021 is really 8.00), unless there is a premium or the amount is under 0.01. */
export function usdcText(amount: string, premium = "0"): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || Number(premium) > 0 || n < 0.01) return amount;
  return n.toFixed(2);
}

/** "1 year", "2 years": a key per form, since t() has no plurals. */
export const yearsText = (n: number, t: T) => (n === 1 ? t("1 year") : t("{n} years", { n }));

export function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
