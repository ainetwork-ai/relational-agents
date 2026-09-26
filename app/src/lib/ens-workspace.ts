// app/src/lib/ens-workspace.ts
// Which ENS family a workspace has (workspace_ens), the chain to read it from, and the short
// in-app hold on a family label while an admin registers it
// (docs/superpowers/plans/2026-09-26-ens-family-settings.md, F6 F10 F14).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceEns } from "@/lib/db/schema";
import type { FamilyChain } from "@/lib/ens-family/chain";
import { chainForRoot, ensReader, familyChain, forgetFamilyChain } from "@/lib/ens-chain";
import { formatUnits } from "viem";
import { availableSuggestions, ethNameStatus } from "@/lib/ens-family/availability";
import { checkLabel } from "@/lib/ens-family/labels";
import { USDC_DECIMALS } from "@/lib/ens-family/config";

export { forgetFamilyChain };

export interface WorkspaceFamily {
  rootName: string;
  fromBlock: bigint;
}

/** The workspace that already uses `rootName`, if any (the unique net behind setWorkspaceFamily). */
export async function workspaceOfRoot(rootName: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: workspaceEns.workspaceId })
    .from(workspaceEns)
    .where(eq(workspaceEns.rootName, rootName))
    .limit(1);
  return row?.workspaceId ?? null;
}

export async function getWorkspaceFamily(workspaceId: string): Promise<WorkspaceFamily | null> {
  const [row] = await db
    .select({ rootName: workspaceEns.rootName, fromBlock: workspaceEns.fromBlock })
    .from(workspaceEns)
    .where(eq(workspaceEns.workspaceId, workspaceId))
    .limit(1);
  return row ? { rootName: row.rootName, fromBlock: BigInt(row.fromBlock) } : null;
}

/** "exists" when this workspace already has a family or another workspace has this root
 *  (both are unique; the database decides, so two racing saves cannot both win). */
export async function setWorkspaceFamily(input: {
  workspaceId: string;
  rootName: string;
  fromBlock: bigint;
  createdBy: string;
}): Promise<"ok" | "exists"> {
  const rows = await db
    .insert(workspaceEns)
    .values({ workspaceId: input.workspaceId, rootName: input.rootName, fromBlock: input.fromBlock.toString(), createdBy: input.createdBy })
    .onConflictDoNothing()
    .returning({ workspaceId: workspaceEns.workspaceId });
  if (!rows.length) return "exists";
  forgetFamilyChain(input.rootName);
  return "ok";
}

/** The workspace's own family, else the deployment's ENS_FAMILY_ROOT (F10), else null. */
export async function familyChainFor(workspaceId: string): Promise<FamilyChain | null> {
  const fam = await getWorkspaceFamily(workspaceId);
  return fam ? chainForRoot(fam.rootName, fam.fromBlock) : familyChain();
}

// ── reservations (F14) ───────────────────────────────────────────────────────
// In memory, one server: it stops two admins of this app from both paying for the same
// label, not outsiders (the registry's own checks cover those).
export const RESERVATION_MS = 30 * 60 * 1000;
interface Hold {
  workspaceId: string;
  expires: number;
}
const gr = globalThis as unknown as { __ensReservations?: Map<string, Hold> };
const holds = (gr.__ensReservations ??= new Map<string, Hold>());
const key = (label: string) => label.trim().toLowerCase();

function liveHold(label: string, now: number): Hold | null {
  const h = holds.get(key(label));
  if (h && h.expires <= now) holds.delete(key(label));
  return h && h.expires > now ? h : null;
}

/** Hold `label` for this workspace for 30 minutes (again: the hold is renewed). */
export function reserveLabel(label: string, workspaceId: string, now = Date.now()): "ok" | "reserved" {
  for (const [k, h] of holds) if (h.expires <= now) holds.delete(k);
  const h = liveHold(label, now);
  if (h && h.workspaceId !== workspaceId) return "reserved";
  holds.set(key(label), { workspaceId, expires: now + RESERVATION_MS });
  return "ok";
}

/** When this workspace's hold ends, or null if it holds nothing on `label`. */
export function reservationExpiry(label: string, workspaceId: string, now = Date.now()): Date | null {
  const h = liveHold(label, now);
  return h && h.workspaceId === workspaceId ? new Date(h.expires) : null;
}

export function reservedByOther(label: string, workspaceId: string, now = Date.now()): boolean {
  const h = liveHold(label, now);
  return !!h && h.workspaceId !== workspaceId;
}

/** Drop the hold on `label`; with `workspaceId`, only when that workspace holds it. */
export function releaseLabel(label: string, workspaceId?: string): void {
  const h = holds.get(key(label));
  if (h && (workspaceId === undefined || h.workspaceId === workspaceId)) holds.delete(key(label));
}

// ── family label availability (F11, F14) ─────────────────────────────────────
export type FamilyLabelAnswer = {
  label: string;
  status: "free" | "taken" | "reserved" | "invalid";
  reason?: "empty" | "too-short" | "too-long" | "invalid";
  /** Only for `free`: the 1-year fee in test USDC (base + premium), and the premium alone. */
  price?: { usdc: string; premiumUsdc: string };
  /** .eth labels free right now and not held by another workspace. Empty when `free`. */
  suggestions: string[];
};

/** Up to 3 free .eth labels from `base`, skipping ones another workspace holds. */
export async function familySuggestions(base: string, workspaceId: string): Promise<string[]> {
  const free = await availableSuggestions(ensReader(), base, 6);
  return free.filter((l) => !reservedByOther(l, workspaceId)).slice(0, 3);
}

/** Is `<input>.eth` free for this workspace? checkLabel (3+) → another workspace's hold →
 *  the global registry. Throws when Sepolia cannot be read (the route answers 502). */
export async function familyLabelStatus(input: string, workspaceId: string): Promise<FamilyLabelAnswer> {
  const checked = checkLabel(input, { min: 3 });
  if (!checked.ok) {
    // a too-short label still has a usable base ("li" → "li-family")
    const suggestions = checked.reason === "too-short" ? await familySuggestions(input, workspaceId) : [];
    return { label: input.trim().toLowerCase(), status: "invalid", reason: checked.reason, suggestions };
  }
  const label = checked.label;
  if (reservedByOther(label, workspaceId)) {
    return { label, status: "reserved", suggestions: await familySuggestions(label, workspaceId) };
  }
  const st = await ethNameStatus(ensReader(), label);
  if (st.status === "free" && st.price) {
    const { base, premium } = st.price;
    return {
      label,
      status: "free",
      price: { usdc: formatUnits(base + premium, USDC_DECIMALS), premiumUsdc: formatUnits(premium, USDC_DECIMALS) },
      suggestions: [],
    };
  }
  return { label, status: "taken", suggestions: await familySuggestions(label, workspaceId) };
}
