// app/src/lib/agent/send-offer.ts
// The send-by-name skill's two inline cards, server side: the "Is this Minjun?" question
// and, after yes, the Send button (cards drawn by lib/agent/send-offer-surface.ts). One row
// per offer in ens_send_offers holds what was asked and where the send stands, so a reload
// or a restart draws the same card, and only the asker can move it forward.
import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, ensSendOffers, users, workspaceMembers } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { makeT, type T } from "@/i18n/translate";
import { SEND_CONFIRM_WORDS } from "@/i18n/content/agent";
import { sendSecret } from "@/lib/ens-chain";
import { familyChainFor } from "@/lib/ens-workspace";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { formatUsdc } from "@/lib/ens-family/send-request";
import { signSendIntent, verifySendIntent, wasSent } from "@/lib/ens-family/send-token";
import { verifiedWallet } from "@/lib/wallet/linked";
import {
  sendOfferMarker,
  sendOfferSurface,
  type CheckState,
  type SendOfferView,
  type SendState,
} from "./send-offer-surface";
import type { A2uiMessage } from "@/lib/x402/a2ui";

type Offer = typeof ensSendOffers.$inferSelect;

/** How long "Is this Minjun?" can be answered. The Send card then has the intent's own 10 minutes. */
export const CHECK_TTL_MS = 30 * 60 * 1000;
/** How long one MetaMask request holds the Send button (a closed tab frees it after this). */
export const LEASE_MS = 5 * 60 * 1000;

/** phases from which Send may start (waiting only once its lease ran out) */
const STARTABLE = ["ready", "cancelled", "failed", "waiting"];
/** failures that need a new question, not another press of Send */
const FINAL_FAIL = ["address-changed", "different"];

export async function createSendOffer(o: {
  workspaceId: string;
  roomId: string;
  askerId: string;
  from: Address;
  name: string;
  displayName: string;
  ensAvatar: string | null;
  to: Address;
  amountMicro: bigint;
}): Promise<string> {
  const [row] = await db
    .insert(ensSendOffers)
    .values({
      workspaceId: o.workspaceId,
      roomId: o.roomId,
      askerId: o.askerId,
      fromAddress: o.from.toLowerCase(),
      ensName: o.name,
      displayName: o.displayName,
      ensAvatar: o.ensAvatar,
      toAddress: o.to.toLowerCase(),
      amountMicro: o.amountMicro.toString(),
    })
    .returning({ id: ensSendOffers.id });
  return row.id;
}

const YES_RE = new RegExp(`^(?:${SEND_CONFIRM_WORDS.yes.join("|")})$`, "i");
const NO_RE = new RegExp(`^(?:${SEND_CONFIRM_WORDS.no.join("|")})$`, "i");

/** "yes" / "no" as a whole message (the @mention, apostrophes and end punctuation dropped), else null. */
export function confirmWord(text: string): "yes" | "no" | null {
  const said = text
    .replace(/@\S+/g, " ")
    .replace(/['’]/g, "")
    .replace(/[.!?~,。…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!said) return null;
  if (YES_RE.test(said)) return "yes";
  if (NO_RE.test(said)) return "no";
  return null;
}

/** The asker's newest open "Is this …?" in this room, if `text` answers it. */
export async function typedSendAnswer(roomId: string, askerId: string, text: string): Promise<{ offerId: string; answer: "yes" | "no" } | null> {
  const answer = confirmWord(text);
  if (!answer) return null;
  const [row] = await db
    .select({ id: ensSendOffers.id })
    .from(ensSendOffers)
    .where(
      and(
        eq(ensSendOffers.roomId, roomId),
        eq(ensSendOffers.askerId, askerId),
        eq(ensSendOffers.phase, "asking"),
        gt(ensSendOffers.createdAt, new Date(Date.now() - CHECK_TTL_MS))
      )
    )
    .orderBy(desc(ensSendOffers.createdAt))
    .limit(1);
  return row ? { offerId: row.id, answer } : null;
}

const vars = (o: Offer) => ({ who: o.displayName, amount: formatUsdc(BigInt(o.amountMicro)) });

/**
 * Yes or No to "Is this Minjun?", from the asker only and only once. Yes re-reads the name
 * on-chain (a wallet that moved since the question stops it) and signs the send intent; the
 * answer is the agent's reply: the Send card, or why not. null = nothing to answer (someone
 * else, already answered, expired) — the card redraws as it stands.
 */
export async function answerSendOffer(offerId: string, askerId: string, answer: "yes" | "no", t: T): Promise<{ text: string } | null> {
  const [o] = await db.select().from(ensSendOffers).where(eq(ensSendOffers.id, offerId));
  if (!o || o.askerId !== askerId || o.phase !== "asking" || o.createdAt.getTime() < Date.now() - CHECK_TTL_MS) return null;
  const open = and(eq(ensSendOffers.id, offerId), eq(ensSendOffers.phase, "asking"));
  if (answer === "no") {
    const done = await db.update(ensSendOffers).set({ phase: "declined", updatedAt: new Date() }).where(open).returning({ id: ensSendOffers.id });
    return done.length ? { text: t("Okay, I won't send it.") } : null;
  }
  const chain = await familyChainFor(o.workspaceId);
  const now = chain ? await chain.resolveAddress(o.ensName).catch(() => undefined) : undefined;
  if (now === undefined) return { text: t("I couldn't reach the network just now. Try again in a moment.") };
  if (!now || now.toLowerCase() !== o.toAddress) {
    const done = await db.update(ensSendOffers).set({ phase: "stale", updatedAt: new Date() }).where(open).returning({ id: ensSendOffers.id });
    return done.length ? { text: t("{who}'s wallet changed since I asked, so I stopped. Ask me again.", vars(o)) } : null;
  }
  const token = signSendIntent(
    {
      userId: o.askerId,
      workspaceId: o.workspaceId,
      roomId: o.roomId,
      from: o.fromAddress as Address,
      name: o.ensName,
      to: o.toAddress as Address,
      amountMicro: o.amountMicro,
    },
    sendSecret()
  );
  const done = await db
    .update(ensSendOffers)
    .set({ phase: "ready", token, updatedAt: new Date() })
    .where(open)
    .returning({ id: ensSendOffers.id });
  return done.length ? { text: sendOfferMarker("send", offerId) } : null;
}

/** The room's agent posts `text` where the question was asked, as privately as the question was. */
export async function postOfferReply(offerId: string, text: string): Promise<void> {
  const [o] = await db.select({ roomId: ensSendOffers.roomId }).from(ensSendOffers).where(eq(ensSendOffers.id, offerId));
  if (!o) return;
  const [bot] = await db
    .select({ agent: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(and(eq(chatRoomBots.roomId, o.roomId), eq(users.isAgent, true)))
    .limit(1);
  if (!bot) return;
  const [question] = await db
    .select({ privateTo: chatMessages.privateToUserId })
    .from(chatMessages)
    .where(and(eq(chatMessages.roomId, o.roomId), sql`position(${sendOfferMarker("check", offerId)} in ${chatMessages.text}) > 0`))
    .limit(1);
  await db.insert(chatMessages).values({ roomId: o.roomId, authorId: bot.agent, text, attachments: [], privateToUserId: question?.privateTo ?? null });
  await publishToRoomMembers(o.roomId, { type: "dm-message", clientId: `agent:${bot.agent}` });
}

const SAFE_PHOTO = /^(?:https:\/\/|\/(?!\/))\S+$/;

/** The workspace member whose signature-proven wallet is the recipient's, if any. */
async function recipientMember(o: Offer) {
  const rows = await db
    .select({ email: users.email, avatarUrl: users.avatarUrl, ainAddress: users.ainAddress, walletVerifiedAt: users.walletVerifiedAt })
    .from(users)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, o.workspaceId)))
    .where(and(sql`lower(${users.ainAddress}) = ${o.toAddress}`, isNotNull(users.walletVerifiedAt), eq(users.isAgent, false)))
    .limit(1);
  return rows.find((r) => verifiedWallet(r) === o.toAddress) ?? null;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return [...letters].slice(0, 2).join("").toUpperCase();
}

function checkStateOf(o: Offer): CheckState {
  if (o.phase === "asking") return o.createdAt.getTime() < Date.now() - CHECK_TTL_MS ? "expired" : "asking";
  if (o.phase === "declined") return "no";
  if (o.phase === "stale") return "changed";
  return "yes";
}

function sendStateOf(o: Offer): SendState | null {
  if (o.phase === "asking" || o.phase === "declined" || o.phase === "stale" || !o.token) return null;
  if (o.phase === "done") return "done";
  if (o.phase === "failed" && FINAL_FAIL.includes(o.failReason ?? "")) return "failed";
  if (o.phase === "sent" || o.txHash || wasSent(o.token)) return "sent";
  const live = verifySendIntent(o.token, sendSecret()) !== null;
  if (o.phase === "waiting") {
    // MetaMask was open when the tab went away: after the lease the button comes back
    if (o.leaseUntil && o.leaseUntil.getTime() > Date.now()) return "waiting";
    return live ? "cancelled" : "expired";
  }
  if (!live) return "expired";
  return o.phase === "cancelled" || o.phase === "failed" ? o.phase : "ready";
}

/** The card as `viewerId` sees it (null: no such offer, or no such card for it yet). */
export async function sendOfferCard(offerId: string, view: SendOfferView, viewerId: string, t: T): Promise<{ messages: A2uiMessage[]; roomId: string } | null> {
  const [o] = await db.select().from(ensSendOffers).where(eq(ensSendOffers.id, offerId));
  if (!o) return null;
  const sendState = view === "send" ? sendStateOf(o) : null;
  if (view === "send" && !sendState) return null;
  const [member, [asker]] = await Promise.all([
    recipientMember(o),
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, o.askerId)),
  ]);
  const canAct = viewerId === o.askerId;
  const photo = member?.avatarUrl && SAFE_PHOTO.test(member.avatarUrl) ? member.avatarUrl : o.ensAvatar?.startsWith("https://") ? o.ensAvatar : null;
  const tx = o.txHash ?? (o.token ? wasSent(o.token) : null);
  const messages = sendOfferSurface(
    {
      offerId,
      view,
      who: o.displayName,
      amount: formatUsdc(BigInt(o.amountMicro)),
      photoUrl: photo,
      initials: initialsOf(o.displayName),
      // the asker checks who this is by it; nobody else in the room gets it
      email: canAct ? (member?.email ?? null) : null,
      inWorkspace: Boolean(member),
      canAct,
      askerName: asker?.displayName ?? t("the person who asked"),
      checkState: view === "check" ? checkStateOf(o) : undefined,
      sendState: sendState ?? undefined,
      failReason: o.failReason,
      explorerUrl: tx ? `${SEPOLIA_EXPLORER}/tx/${tx}` : null,
      token: canAct && sendState !== "done" ? o.token : null,
    },
    t
  );
  // the asker's browser confirms a hash the server hasn't seen yet with this
  if (canAct && tx) {
    const model = messages[2];
    if ("updateDataModel" in model && model.updateDataModel.value && typeof model.updateDataModel.value === "object")
      Object.assign(model.updateDataModel.value as Record<string, unknown>, { tx_hash: tx });
  }
  return { messages, roomId: o.roomId };
}

export async function offerRoom(offerId: string): Promise<string | null> {
  const [o] = await db.select({ roomId: ensSendOffers.roomId }).from(ensSendOffers).where(eq(ensSendOffers.id, offerId));
  return o?.roomId ?? null;
}

export type StartSend =
  | { ok: true; wallet: { token: string; from: Address; to: Address; amountMicro: string } }
  | { ok: false; reason: string };

async function fail(offerId: string, reason: string): Promise<StartSend> {
  await db
    .update(ensSendOffers)
    .set({ phase: "failed", failReason: reason, leaseUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(ensSendOffers.id, offerId),
        inArray(ensSendOffers.phase, STARTABLE),
        isNull(ensSendOffers.txHash),
        // never over another tab's open MetaMask request
        or(isNull(ensSendOffers.leaseUntil), lt(ensSendOffers.leaseUntil, new Date()))
      )
    );
  return { ok: false, reason };
}

/**
 * Send was pressed: every check the transfer needs, then one lease so a second press (another
 * tab, a double click that got past the button) gets no second wallet request. The wallet
 * receives exactly the intent the Yes signed.
 */
export async function startSend(offerId: string, userId: string): Promise<StartSend> {
  const [o] = await db.select().from(ensSendOffers).where(eq(ensSendOffers.id, offerId));
  if (!o || o.askerId !== userId) return { ok: false, reason: "not-yours" };
  const state = sendStateOf(o);
  const final = state === "failed" && FINAL_FAIL.includes(o.failReason ?? "");
  if (!o.token || !state || final || !["ready", "cancelled", "failed"].includes(state)) return { ok: false, reason: state ?? "not-ready" };
  const intent = verifySendIntent(o.token, sendSecret());
  if (!intent || intent.userId !== userId) return { ok: false, reason: "expired" };

  const [me] = await db.select({ ainAddress: users.ainAddress, walletVerifiedAt: users.walletVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!me || verifiedWallet(me) !== intent.from.toLowerCase()) return fail(offerId, "no-wallet");

  const chain = await familyChainFor(o.workspaceId);
  const read = chain ? await Promise.all([chain.resolveAddress(o.ensName), chain.balances(intent.from)]).catch(() => null) : null;
  if (!read) return fail(offerId, "chain-unavailable");
  const [now, bal] = read;
  if (!now || now.toLowerCase() !== intent.to.toLowerCase()) return fail(offerId, "address-changed");
  if (bal.usdcMicro < BigInt(intent.amountMicro)) return fail(offerId, "low-usdc");

  const took = await db
    .update(ensSendOffers)
    .set({ phase: "waiting", failReason: null, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(
      and(
        eq(ensSendOffers.id, offerId),
        inArray(ensSendOffers.phase, STARTABLE),
        isNull(ensSendOffers.txHash),
        or(isNull(ensSendOffers.leaseUntil), lt(ensSendOffers.leaseUntil, new Date()))
      )
    )
    .returning({ id: ensSendOffers.id });
  // the checks above ran outside the UPDATE, so two presses can both reach it: its WHERE is the
  // lock — one gets the lease, the other is told "busy" and the winner's row is left as it is
  if (!took.length || wasSent(o.token)) return { ok: false, reason: "busy" };
  return { ok: true, wallet: { token: o.token, from: intent.from, to: intent.to, amountMicro: intent.amountMicro } };
}

const WALLET_REASONS = new Set(["wrong-account", "no-provider", "failed"]);

/** MetaMask said no (cancelled) or couldn't (failed, with the wallet's reason): the button comes back. */
export async function endSend(offerId: string, userId: string, outcome: "cancelled" | "failed", reason: string | null): Promise<void> {
  await db
    .update(ensSendOffers)
    .set({
      phase: outcome,
      failReason: outcome === "failed" ? (reason && WALLET_REASONS.has(reason) ? reason : "failed") : null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(ensSendOffers.id, offerId), eq(ensSendOffers.askerId, userId), eq(ensSendOffers.phase, "waiting"), isNull(ensSendOffers.txHash)));
}

/**
 * /api/ens/send/confirm keeps the offer in step with the intent it spends (a /send link has no
 * offer: nothing matches). `sent` the moment the wallet hands a hash over; then the check's
 * outcome: match → done, mismatch (no USDC moved) → Send again, different → failed.
 */
export async function recordOfferTx(token: string, txHash: string, outcome: "sent" | "match" | "mismatch" | "different" | "pending"): Promise<void> {
  const hash = txHash.toLowerCase();
  const mine = and(eq(ensSendOffers.token, token), or(isNull(ensSendOffers.txHash), eq(ensSendOffers.txHash, hash)));
  const now = new Date();
  if (outcome === "sent" || outcome === "pending")
    await db
      .update(ensSendOffers)
      .set({ phase: "sent", txHash: hash, leaseUntil: null, failReason: null, updatedAt: now })
      .where(and(mine, sql`${ensSendOffers.phase} <> 'done'`));
  else if (outcome === "match") await db.update(ensSendOffers).set({ phase: "done", txHash: hash, leaseUntil: null, failReason: null, updatedAt: now }).where(mine);
  else if (outcome === "mismatch")
    await db
      .update(ensSendOffers)
      .set({ phase: "ready", txHash: null, leaseUntil: null, failReason: "no-usdc-moved", updatedAt: now })
      .where(and(eq(ensSendOffers.token, token), eq(ensSendOffers.txHash, hash)));
  else await db.update(ensSendOffers).set({ phase: "failed", txHash: hash, leaseUntil: null, failReason: "different", updatedAt: now }).where(mine);
}

/** The reply language for a button press: the asker's saved language, else English. */
export function tFor(language: string | null | undefined): T {
  return makeT(language === "ko" ? "ko" : "en");
}
