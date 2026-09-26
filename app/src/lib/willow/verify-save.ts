import "server-only";
import { AindriveError, aindriveHttp } from "@/lib/aindrive";
import { runAsOrService } from "@/lib/aindrive-account";
import type { Transaction } from "@/lib/transactions/types";
import { verifyEntry, verifyTransaction, type WireJson } from "@/lib/willow/entry";
import { bindingValid } from "@/lib/willow/binding";
import { signingOf } from "@/lib/willow/record-drive";

/**
 * The save route's Willow step for one page (docs/willow-ainmem-plan.md Task 6).
 *
 * Signed transactions are checked here — the entry's signature, its place
 * (["ainmem", teamspace, page, tx] in the teamspace's record drive), the device
 * key's binding to the session's user, the device's certificate entry — and the
 * signed payload replaces the body's copy. Then they go to aindrive's store, as
 * the account that linked the drive:
 * - aindrive refuses one (revoked device, bad certificate): it is not applied;
 * - aindrive refuses because nobody involved may write to the drive
 *   ("not-a-member"): applied, only not recorded — ainmem's own rights decided;
 * - aindrive cannot be reached: applied, and `retry` asks the browser to send it
 *   again later (the apply is idempotent by id), so the drive gets it then;
 * - no aindrive account to hand it in as: applied, not recorded.
 * Unsigned transactions pass through as before.
 */
export async function verifyAndForward(
  pageId: string,
  userId: string | null,
  transactions: Transaction[]
): Promise<{ accepted: Transaction[]; rejected: { id: string; reason: string }[]; retry: boolean }> {
  const signed = transactions.filter((t) => t.signed);
  if (signed.length === 0) return { accepted: transactions, rejected: [], retry: false };
  const rejected: { id: string; reason: string }[] = [];
  const s = await signingOf(pageId);
  const verified = new Map<string, Transaction>();
  const certs = new Map<string, WireJson>();
  for (const t of signed) {
    const env = t.signed!;
    const refuse = (reason: string) => rejected.push({ id: t.id, reason });
    if (!s || !userId) { refuse("signed, but this page's edits are not signed"); continue; }
    if (env.drive !== s.driveId) { refuse("signed for another drive"); continue; }
    const v = await verifyTransaction(env.entry, { driveId: s.driveId, teamspaceId: s.teamspaceId, pageId, id: t.id });
    if (!v.ok) { refuse(v.reason); continue; }
    if (!bindingValid(userId, v.deviceKey, env.binding)) { refuse("device key is not this user's"); continue; }
    const c = await verifyEntry(env.cert, s.driveId);
    if (!c.ok || c.deviceKey !== v.deviceKey || c.path.join("/") !== "_id/cert") { refuse("bad device certificate"); continue; }
    certs.set(env.cert.tok, env.cert);
    verified.set(t.id, { ...v.t, signed: env });
  }

  let retry = false;
  if (verified.size && s) {
    const txs = [...verified.values()];
    const entries = [...certs.values(), ...txs.map((t) => t.signed!.entry)];
    try {
      const res = await runAsOrService(s.createdBy, () =>
        aindriveHttp("/api/willow/ingest", { method: "POST", body: JSON.stringify({ drive: s.driveId, entries }) }, 10_000)
      );
      if (res.status >= 500) retry = true;
      else if (res.ok) {
        const { results } = (await res.json()) as { results: (string | null)[] };
        txs.forEach((t, i) => {
          const why = results[certs.size + i];
          if (why && why !== "not-a-member") {
            rejected.push({ id: t.id, reason: `aindrive: ${why}` });
            verified.delete(t.id);
          }
        });
      }
      // other 4xx (the linker's session expired): applied, not recorded
    } catch (e) {
      if (!(e instanceof AindriveError)) retry = true; // network: try again later
    }
  }
  const refused = new Set(rejected.map((r) => r.id));
  const accepted = transactions.filter((t) => !refused.has(t.id)).map((t) => verified.get(t.id) ?? t);
  return { accepted, rejected, retry };
}
