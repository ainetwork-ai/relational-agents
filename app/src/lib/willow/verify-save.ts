import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions as txTable } from "@/lib/db/schema";
import { AindriveError, aindriveHttp } from "@/lib/aindrive";
import { runAsOrService } from "@/lib/aindrive-account";
import type { SignedEnvelope, Transaction } from "@/lib/transactions/types";
import { verifyEntry, verifyTransaction, type WireJson } from "@/lib/willow/entry";
import { bindingValid } from "@/lib/willow/binding";
import { signingOf } from "@/lib/willow/record-drive";

/**
 * The save route's Willow steps for one page (docs/willow-ainmem-plan.md Task 6).
 *
 * 1. verifySigned, before the apply: a signed transaction's signature, place
 *    (["ainmem", teamspace, page, tx] in the teamspace's record drive), the device
 *    key's binding to the session's user and the device's certificate are checked,
 *    and the signed payload replaces the body's copy. A signature that does not
 *    check out is dropped and the edit applies unsigned — unsigned edits are
 *    accepted anyway, so refusing would only lose honest people's text (a rotated
 *    secret, a moved page, a stale cache) and protect nothing (review C1). The
 *    client is told, so it fetches a fresh certificate.
 * 2. recordSigned, after the apply: what was applied goes to aindrive's store as
 *    the account that linked the drive. Only transactions this user's own session
 *    applied are handed in, so nobody can re-sign another person's transaction id
 *    and take its authorship (review I3). aindrive unreachable → `unrecorded`, and
 *    the browser hands them in again later through /api/willow/record; the save
 *    itself has succeeded (review I4).
 */

const INGEST_CHUNK = 150;

export interface Verified {
  /** what to apply: signed payloads where the signature holds, the rest as sent, unsigned */
  transactions: Transaction[];
  /** transaction id → its verified envelope */
  signed: Map<string, SignedEnvelope>;
  /** ids whose signature was dropped */
  signatureRefused: string[];
}

export async function verifySigned(pageId: string, userId: string | null, transactions: Transaction[]): Promise<Verified> {
  const signed = new Map<string, SignedEnvelope>();
  const signatureRefused: string[] = [];
  if (!transactions.some((t) => t.signed)) return { transactions: transactions.map(strip), signed, signatureRefused };
  const s = await signingOf(pageId);
  const out: Transaction[] = [];
  for (const t of transactions) {
    const env = t.signed;
    if (!env) {
      out.push(t);
      continue;
    }
    const why = await check(t, env, s, pageId, userId);
    if (typeof why === "string") {
      console.warn(`[willow] ${t.id}: signature dropped (${why}); applied unsigned`);
      signatureRefused.push(t.id);
      out.push(strip(t));
      continue;
    }
    signed.set(t.id, env);
    out.push(why);
  }
  return { transactions: out, signed, signatureRefused };
}

function strip(t: Transaction): Transaction {
  const { signed: _signed, ...rest } = t;
  return rest;
}

async function check(
  t: Transaction,
  env: SignedEnvelope,
  s: Awaited<ReturnType<typeof signingOf>>,
  pageId: string,
  userId: string | null
): Promise<Transaction | string> {
  if (!s || !userId) return "this page's edits are not signed";
  if (!env || typeof env !== "object" || env.drive !== s.driveId) return "signed for another drive";
  const v = await verifyTransaction(env.entry, { driveId: s.driveId, teamspaceId: s.teamspaceId, pageId, id: t.id });
  if (!v.ok) return v.reason;
  if (!bindingValid(userId, v.deviceKey, env.binding)) return "device key is not this user's";
  const c = await verifyEntry(env.cert, s.driveId);
  if (!c.ok || c.deviceKey !== v.deviceKey || c.path.join("/") !== "_id/cert") return "bad device certificate";
  return strip(v.t);
}

/** Hand the signed entries of transactions this user applied to the drive's store. */
export async function recordSigned(
  pageId: string,
  userId: string | null,
  signed: Map<string, SignedEnvelope>
): Promise<{ unrecorded: string[]; signatureRefused: string[] }> {
  const none = { unrecorded: [], signatureRefused: [] };
  if (!signed.size || !userId) return none;
  const s = await signingOf(pageId);
  if (!s) return none;
  // only what this user's session applied: a duplicate id someone else applied is theirs
  const mine = new Set(
    (
      await db
        .select({ id: txTable.id })
        .from(txTable)
        .where(and(inArray(txTable.id, [...signed.keys()]), eq(txTable.userId, userId), eq(txTable.pageId, pageId)))
    ).map((r) => r.id)
  );
  const ids = [...signed.keys()].filter((id) => mine.has(id) && signed.get(id)!.drive === s.driveId);
  const unrecorded: string[] = [];
  const signatureRefused: string[] = [];
  for (let i = 0; i < ids.length; i += INGEST_CHUNK) {
    const chunk = ids.slice(i, i + INGEST_CHUNK);
    const certs = new Map<string, WireJson>();
    for (const id of chunk) certs.set(signed.get(id)!.cert.tok, signed.get(id)!.cert);
    const entries = [...certs.values(), ...chunk.map((id) => signed.get(id)!.entry)];
    try {
      const res = await runAsOrService(s.createdBy, () =>
        aindriveHttp("/api/willow/ingest", { method: "POST", body: JSON.stringify({ drive: s.driveId, entries }) }, 5_000)
      );
      if (!res.ok) {
        if (res.status >= 500 || res.status === 413 || res.status === 429) unrecorded.push(...chunk);
        else console.warn(`[willow] ${s.driveId}: aindrive answered ${res.status}; ${chunk.length} edits applied, not recorded`);
        continue;
      }
      const { results } = (await res.json()) as { results: (string | null)[] };
      chunk.forEach((id, k) => {
        const why = results[certs.size + k];
        if (!why) return;
        console.warn(`[willow] ${id}: aindrive did not record it (${why})`);
        if (why !== "not-a-member") signatureRefused.push(id);
      });
    } catch (e) {
      if (e instanceof AindriveError) console.warn(`[willow] ${s.driveId}: ${e.message}; edits applied, not recorded`);
      else unrecorded.push(...chunk); // network: the browser hands them in again later
    }
  }
  return { unrecorded, signatureRefused };
}
