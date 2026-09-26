import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { b64, findGift, unb64, type GiftSpec, type GiftUnlock, type PaymentRequirements } from "@/lib/gift";
import { selfOrigin } from "@/lib/app-origin";
import { providerById, providerFor } from "./index";
import { say, type Emit, type PayState } from "./agui";

export type PayOutcome =
  | { ok: true; receipt: string; already?: boolean; unlock: GiftUnlock | null; spec: GiftSpec; settlement?: string }
  | { ok: false; status: number; error: string };

const quiet: Emit = () => {};

/**
 * Pays for a gift the x402 way, as `payerId`, over HTTP against the gift's own
 * resource: ask → 402 PAYMENT-REQUIRED → sign → retry with PAYMENT-SIGNATURE →
 * 200 PAYMENT-RESPONSE. The same round trip any x402 client makes.
 *
 * The 402 names the settlement the recipient is paid through; the payer signs
 * with the provider of that name (their aindrive wallet, or the family
 * wallet this server keeps). Progress goes out as AG-UI events on `emit`.
 */
export async function payGift(payerId: string, giftId: string, origin?: string, emit: Emit = quiet): Promise<PayOutcome> {
  const threadId = `gift:${giftId}`;
  const runId = `run_${randomBytes(6).toString("base64url")}`;
  const state: PayState = { giftId, step: "quote" };
  const snapshot = () => emit({ type: "STATE_SNAPSHOT", snapshot: { ...state } });
  const fail = (status: number, error: string): PayOutcome => {
    state.step = "failed";
    state.error = error;
    snapshot();
    emit({ type: "RUN_ERROR", message: error, code: String(status) });
    return { ok: false, status, error };
  };

  emit({ type: "RUN_STARTED", threadId, runId });
  const base = selfOrigin(origin);
  const get = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/gift/${encodeURIComponent(giftId)}`, { headers, cache: "no-store" });

  // ── quote: what does the resource want? ──
  emit({ type: "STEP_STARTED", stepName: "quote" });
  const first = await get();
  if (first.status === 200) {
    const found = await findGift(giftId);
    if (!found) return fail(404, "gift not found");
    state.step = "done";
    state.receipt = found.gift.unlock?.receipt;
    snapshot();
    emit({ type: "STEP_FINISHED", stepName: "quote" });
    emit({ type: "RUN_FINISHED", threadId, runId, result: { already: true } });
    return { ok: true, receipt: found.gift.unlock?.receipt ?? "", already: true, unlock: found.gift.unlock ?? null, spec: found.gift.spec };
  }
  if (first.status !== 402) return fail(first.status, `unexpected ${first.status}`);
  const required = unb64<{ accepts?: PaymentRequirements[]; resource?: { url: string } }>(first.headers.get("PAYMENT-REQUIRED") ?? "");
  const req = required?.accepts?.[0];
  if (!req) return fail(502, "no payment requirements in the 402");
  const settlement = String(req.extra?.settlement ?? "");
  const provider = providerById(settlement);
  if (!provider) return fail(502, `the resource wants a settlement this app does not know: ${settlement || "(none)"}`);
  state.settlement = provider.id;
  state.requirements = req;
  snapshot();
  emit({ type: "STEP_FINISHED", stepName: "quote" });
  say(emit, `402 · ${req.extra?.display ? `₩${(req.extra.display as { krw?: number }).krw?.toLocaleString("ko-KR")}` : req.amount} → ${req.payTo.slice(0, 8)}… (${provider.id})`);

  // ── sign: the payer's wallet, wherever it is ──
  emit({ type: "STEP_STARTED", stepName: "sign" });
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, payerId));
  const payer = { userId: payerId, name: u?.name ?? "" };
  let payment;
  try {
    payment = await provider.sign(payer, req, required?.resource?.url ?? "");
  } catch (e) {
    return fail(502, (e as Error).message);
  }
  state.step = "sign";
  state.payer = payment.payload.authorization.from;
  snapshot();
  emit({ type: "STEP_FINISHED", stepName: "sign" });

  // ── settle: the resource verifies, settles, unlocks ──
  emit({ type: "STEP_STARTED", stepName: "settle" });
  state.step = "settle";
  snapshot();
  const paid = await get({ "PAYMENT-SIGNATURE": b64(payment) });
  const body = (await paid.json().catch(() => ({}))) as { error?: string; receipt?: string };
  if (!paid.ok) return fail(paid.status, body.error ?? `payment refused (${paid.status})`);
  const response = unb64<{ transaction?: string }>(paid.headers.get("PAYMENT-RESPONSE") ?? "");
  state.receipt = body.receipt ?? "";
  state.transaction = response?.transaction;
  emit({ type: "STEP_FINISHED", stepName: "settle" });

  // ── unlock: the block now carries the stamped unlock ──
  emit({ type: "STEP_STARTED", stepName: "unlock" });
  const found = await findGift(giftId);
  if (!found) return fail(404, "gift not found");
  state.step = "done";
  snapshot();
  emit({ type: "STEP_FINISHED", stepName: "unlock" });
  emit({ type: "RUN_FINISHED", threadId, runId, result: { receipt: state.receipt, settlement: provider.id } });
  return { ok: true, receipt: state.receipt, unlock: found.gift.unlock ?? null, spec: found.gift.spec, settlement: provider.id };
}

/** Which provider a gift's recipient is paid through, and where. */
export async function recipientSettlement(spec: GiftSpec): Promise<{ settlement: string; payTo: string }> {
  const provider = await providerFor(spec.recipientUserId);
  // the family wallet was fixed into the spec when the gift was made; aindrive's is asked for
  const payTo = provider.id === "family-ledger" ? spec.payTo : await provider.payToOf(spec.recipientUserId);
  return { settlement: provider.id, payTo };
}
