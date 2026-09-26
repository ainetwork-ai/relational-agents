import "server-only";
import { aindriveHttp, listFiles } from "@/lib/aindrive";
import { getAccount, runAs, runAsOrService } from "@/lib/aindrive-account";
import type { TeamspaceDrive } from "@/lib/db/schema";

/**
 * A single FILE shared into a teamspace (aindrive's share sheet can link a file,
 * not only a folder). When its owner has it on sale in aindrive — a paid share
 * at exactly that path — members buy it with their own wallet (MetaMask), the
 * way aindrive's /s/<token> page sells it:
 *
 *   quote  GET /api/s/<token>  as the buyer's aindrive account → 402, or 200
 *                              when that account already has access
 *   pay    the same + PAYMENT-SIGNATURE (signed in the buyer's browser)
 *
 * Both go as the BUYER's aindrive account, so aindrive credits the purchase to
 * it: the entitlement lives in aindrive, and "may they open it" is aindrive's
 * own 200 for that account. The owner, and everyone when the file is not on
 * sale, open it as with any shared folder.
 */

export interface SharedFile {
  name: string;
  size: number | null;
}

export interface FileSale {
  token: string;
  price: number;
  currency: string;
}

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** The shared item as a file, or null when it is a folder (or the whole drive). */
export async function sharedFile(drive: TeamspaceDrive): Promise<SharedFile | null> {
  if (!drive.root) return null;
  const entries = await runAsOrService(drive.createdBy, () => listFiles({ driveId: drive.driveId, root: "" }, parentOf(drive.root))).catch(() => null);
  const e = entries?.find((x) => x.name === baseOf(drive.root));
  if (!e || e.isDir) return null;
  return { name: e.name, size: typeof e.size === "number" ? e.size : null };
}

/** The owner's paid share of exactly this file, if it is on sale. */
export async function fileSale(drive: TeamspaceDrive): Promise<FileSale | null> {
  if (!drive.createdBy || !drive.root) return null;
  const r = await runAs(drive.createdBy, () => aindriveHttp(`/api/drives/${encodeURIComponent(drive.driveId)}/shares`)).catch(() => null);
  if (!r?.ok) return null;
  const { shares } = (await r.json().catch(() => ({ shares: [] }))) as {
    shares?: { token: string; path: string; price_usdc?: number | null; currency?: string | null; expires_at?: string | null }[];
  };
  const s = (shares ?? []).find(
    (x) => x.path === drive.root && !!x.price_usdc && (!x.expires_at || new Date(x.expires_at) > new Date())
  );
  return s ? { token: s.token, price: Number(s.price_usdc), currency: s.currency || "USDC" } : null;
}

export type Quote =
  | { state: "unlocked" }
  | { state: "quote"; paymentRequired: string }
  | { state: "needs-account" }
  | { state: "error"; status: number; error: string };

/** aindrive's answer to this buyer for the sale: already theirs, or the 402 to sign. */
export async function quoteFor(userId: string, sale: FileSale, paymentSignature?: string): Promise<Quote & { txHash?: string }> {
  if (!(await getAccount(userId).catch(() => null))) return { state: "needs-account" };
  const r = await runAs(userId, () =>
    aindriveHttp(
      `/api/s/${encodeURIComponent(sale.token)}`,
      paymentSignature ? { headers: { "PAYMENT-SIGNATURE": paymentSignature } } : {},
      paymentSignature ? 120_000 : 30_000
    )
  ).catch((e: Error) => e);
  if (r instanceof Error) return { state: "error", status: 502, error: r.message };
  const body = (await r.json().catch(() => ({}))) as { txHash?: string; error?: string };
  if (r.ok) return { state: "unlocked", txHash: body.txHash };
  const header = r.headers.get("PAYMENT-REQUIRED");
  if (r.status === 402 && header && !paymentSignature) return { state: "quote", paymentRequired: header };
  let error = body.error ?? `aindrive answered ${r.status}`;
  // aindrive words a failed on-chain check (most often: not enough USDC) as "facilitator unavailable"
  if (/facilitator unavailable/i.test(error))
    error = `The payment didn't go through. Check that this wallet holds at least ${sale.price} ${sale.currency} on Base, then try again.`;
  return { state: "error", status: r.status === 402 ? 402 : 502, error };
}

// "may this person open it" is asked of aindrive; remembered briefly so a page of
// previews does not ask once per request
const seen = new Map<string, { at: number; ok: boolean }>();

/** Whether `userId` may open the shared file: owner, not on sale, or bought. */
export async function mayOpen(userId: string, drive: TeamspaceDrive): Promise<boolean> {
  if (!drive.root || drive.createdBy === userId) return true;
  const key = `${userId}:${drive.id}`;
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  // only a link that IS a file is sold here; a shared folder opens as before
  const sale = (await sharedFile(drive)) ? await fileSale(drive) : null;
  const ok = !sale || (await quoteFor(userId, sale)).state === "unlocked";
  seen.set(key, { at: Date.now(), ok });
  return ok;
}

export function forgetOpen(userId: string, driveLinkId: string) {
  seen.delete(`${userId}:${driveLinkId}`);
}
