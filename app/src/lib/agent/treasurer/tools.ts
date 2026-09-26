import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomBots, treasuryActions, treasuryApprovals, treasurySeats, users } from "@/lib/db/schema";
import { idpMode } from "@/lib/auth/world";
import type { AiTool } from "@/lib/ai";
import type { T } from "@/i18n";
import type { A2uiMessage } from "@/lib/x402/a2ui";
import { treasuryStatus } from "@/lib/agent/treasury/approvals";
import { INVEST_CHAIN } from "@/lib/agent/treasury/invest";
import { humanMemberIds, latestAdoption, loadRelationTreasury } from "@/lib/agent/treasury/memory";
import { evaluateCommand } from "@/lib/agent/treasury/policy";
import {
  RecurringBuyRefusal,
  authorityExposure,
  digestShort,
  proposeRecurringBuy,
  recurringBuyStatus,
  roomRecurringBuys,
  runRecurringBuy,
  stopRecurringBuy,
  termsPhrase,
  type RecurringRunResult,
} from "@/lib/agent/treasury/recurring";
import { SKIP_REASON_TEXT, termsDigest } from "@/lib/agent/treasury/recurring-record";
import { describeTreasuryAction } from "@/lib/agent/treasury/summary";
import type { TreasuryKind } from "@/lib/agent/treasury/types";
import { treasuryBalance, ensureAgentWallet } from "@/lib/agent/treasury/wallet";
import { postRoomMessage } from "./history";
import { recurringBuyMarker, recurringBuySurface, type RecurringBuySurfaceInput } from "./surfaces";

/**
 * The treasurer's tools. The model picks which to call and with what; each
 * handler decides on its own whether the asker may, re-reading membership
 * every call — the model's say-so is never a permission. Spending exists only
 * as buy_this_week, which runs inside a recurring buy the members adopted
 * (recurring.ts decides and bounds it); propose only queues a request that
 * World ID approvals must adopt; stop only narrows.
 *
 * Results are JSON for the model plus, optionally, an A2UI surface for the
 * asker's screen. What the room sees (a proposal card, a buy, a stop) is
 * posted here as the agent's own message, in fixed English.
 */

export interface TreasurerContext {
  roomId: string;
  agentUserId: string;
  askerId: string;
  askerName: string;
  t: T;
}

export interface ToolOutcome {
  /** what the model reads back */
  result: Record<string, unknown>;
  /** drawn on the asker's screen */
  surface?: A2uiMessage[];
  /** the recurring-buy card the answer should keep (its marker goes into the saved answer) */
  cardActionId?: string;
}

interface TreasurerTool {
  def: AiTool;
  run(args: Record<string, unknown>, ctx: TreasurerContext): Promise<ToolOutcome>;
}

// ── who may ─────────────────────────────────────────────────────────────────

/** The room's own agent — the one whose wallet holds the pot (treasuryStatus picks the same). */
export async function roomAgent(roomId: string): Promise<{ agentUserId: string; displayName: string } | null> {
  const [bot] = await db
    .select({ agentUserId: chatRoomBots.agentUserId, displayName: users.displayName })
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(and(eq(chatRoomBots.roomId, roomId), eq(users.isAgent, true)))
    .orderBy(asc(chatRoomBots.importedAt))
    .limit(1);
  return bot ?? null;
}

async function isHumanMember(roomId: string, userId: string): Promise<boolean> {
  return (await humanMemberIds(roomId)).includes(userId);
}

/** Who votes: the members at the adoption in force, else the members now (recurring.ts / memory.ts say the same). */
async function electorate(roomId: string): Promise<string[]> {
  return (await latestAdoption(roomId))?.text.members ?? humanMemberIds(roomId);
}

const NOT_MEMBER = { ok: false, refused: "Only current members of this room can use its treasury." };
const NOT_VOTER = {
  ok: false,
  refused: "Only members who were here when our rules were adopted can direct the treasury — nothing was done.",
};

// ── formatting (fixed English: these lines reach the shared room) ───────────

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** "Mon 30 Mar 2027 00:00 UTC" */
function whenUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${day.replace(/,/g, "")} ${d.toISOString().slice(11, 16)} UTC`;
}

function weth(amount: string): string {
  const n = Number(amount);
  return n >= 0.01 ? n.toFixed(4) : n.toPrecision(3);
}

async function postAsAgent(ctx: TreasurerContext, text: string): Promise<void> {
  await postRoomMessage({ roomId: ctx.roomId, authorId: ctx.agentUserId, text, privateToUserId: null, byAgent: true }).catch(
    (err: unknown) => console.error("treasurer: posting to the room failed:", err)
  );
}

// ── the recurring-buy card ──────────────────────────────────────────────────

/**
 * The card for one recurring-buy action as `viewerId` sees it now, or null
 * when the room has no such action. Reads only the database.
 */
export async function recurringBuySurfaceFor(
  roomId: string,
  actionId: string,
  viewerId: string,
  t: T,
  notice?: string
): Promise<A2uiMessage[] | null> {
  const authority = (await roomRecurringBuys(roomId)).find((a) => a.actionId === actionId);
  if (!authority) return null;
  const [status, members, voters, seat, mine] = await Promise.all([
    recurringBuyStatus(roomId),
    humanMemberIds(roomId),
    electorate(roomId),
    db
      .select({ id: treasurySeats.id })
      .from(treasurySeats)
      .where(and(eq(treasurySeats.roomId, roomId), eq(treasurySeats.userId, viewerId)))
      .limit(1),
    db
      .select({ id: treasuryApprovals.id })
      .from(treasuryApprovals)
      .where(and(eq(treasuryApprovals.actionId, actionId), eq(treasuryApprovals.userId, viewerId)))
      .limit(1),
  ]);
  const { record } = authority;
  const verified = termsDigest(record.terms) === record.digest.toLowerCase();
  const live = status.live?.actionId === actionId ? status.live : null;
  const pending = status.pending?.actionId === actionId ? status.pending : null;
  const state: RecurringBuySurfaceInput["state"] = !verified
    ? "closed"
    : live
      ? "live"
      : pending
        ? "pending"
        : authority.status === "executed"
          ? record.revokedAt !== undefined
            ? "stopped"
            : "ended"
          : "closed";
  return recurringBuySurface(
    {
      actionId,
      roomId,
      state,
      weeklyUsd: record.terms.weeklyUsd,
      weeks: record.terms.weeks,
      exposureUsd: authorityExposure(record),
      agentAddress: record.terms.agentAddress,
      agentAddressUrl: `${INVEST_CHAIN.explorer}/address/${record.terms.agentAddress}`,
      digestShort: digestShort(record.digest),
      rule: record.rule,
      approvals: authority.approvals,
      required: authority.required,
      approvedBy: authority.approvedBy,
      canApprove: state === "pending" && seat.length > 0 && voters.includes(viewerId) && mine.length === 0,
      approvalsOpen: idpMode() !== null,
      canStop: members.includes(viewerId),
      progress: live
        ? {
            weekIndex: live.weekIndex,
            boughtWeeks: live.boughtWeeks,
            investedUsd: live.investedUsd,
            wethOut: live.wethOut,
            thisWeek: live.thisWeek,
            nextRunAt: live.nextRunAt,
          }
        : undefined,
      notice: notice ?? (verified ? undefined : t("Its terms no longer match what was approved — it authorises nothing.")),
    },
    t
  );
}

/**
 * Stops the room's recurring buy for `byUserId` and tells the room. Shared
 * by the stop tool and the card's Stop button, so both leave the same trace.
 */
export async function stopAndAnnounce(ctx: TreasurerContext): Promise<{ ok: true; actionId: string; line: string } | { ok: false; reason: string }> {
  const before = await recurringBuyStatus(ctx.roomId);
  const stopped = await stopRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  if (!stopped.ok) return stopped;
  const wasLive = before.live?.actionId === stopped.actionId;
  const terms = wasLive ? before.live : before.pending;
  const phrase = terms ? ` (${termsPhrase(terms)})` : "";
  const line = wasLive
    ? `Stopped the recurring buy${phrase} at ${ctx.askerName}'s request. I won't buy again under it.`
    : `Withdrew the recurring buy request${phrase} at ${ctx.askerName}'s request — it won't be adopted.`;
  await postAsAgent(ctx, line);
  return { ok: true, actionId: stopped.actionId, line };
}

/**
 * Runs this week's buy for `ctx.askerId` and tells the room when money moved.
 * Shared by the buy tool and the panel's button, so both leave the same trace.
 * Throws a RecurringBuyRefusal when the asker may not direct the treasury.
 */
export async function runAndAnnounce(ctx: TreasurerContext): Promise<{ run: RecurringRunResult; line: string | null }> {
  const run = await runRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  if (run.outcome !== "bought") return { run, line: null };
  const line = `Bought at ${ctx.askerName}'s request: ${usd(run.weeklyUsd)} → ${weth(run.wethOut)} WETH on Base (week ${run.isoWeek}). tx ${run.txUrl}`;
  await postAsAgent(ctx, line);
  return { run, line };
}

// ── the tools ───────────────────────────────────────────────────────────────

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const getTreasuryStatus: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "get_treasury_status",
      description:
        "Read the relation's treasury now: the pot balance, whether rules were adopted, members and who can vote, requests waiting for approval, invested funds, and the recurring buy in one line. Call this before answering anything about balances or pending requests.",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const s = await treasuryStatus(ctx.roomId, ctx.askerId);
    if (!s.enabled) return { result: { ok: true, enabled: false, note: "This room has no Treasury Rules section, so it has no treasury." } };
    return {
      result: {
        ok: true,
        enabled: true,
        balanceUsd: s.balanceUsd,
        balanceNote: "demo scale: story dollars backed by Sepolia ETH",
        agentAddress: s.address,
        rulesAdopted: s.adoptedAt !== null,
        adoptedAt: s.adoptedAt,
        rules: s.rules,
        unadoptedChanges: s.proposal,
        members: s.members.map((m) => ({ name: m.displayName, votes: m.voting, seated: m.seated })),
        waitingForApproval: s.actions
          .filter((a) => a.status === "pending")
          .map((a) => ({
            kind: a.kind,
            amountUsd: a.amountUsd,
            memo: a.memo,
            approvals: a.approvals.length,
            required: a.requiredApprovals,
            rule: a.ruleText,
            requestedBy: a.requestedBy.displayName,
            youCanApprove: a.canApprove,
            expiresAt: a.expiresAt,
          })),
        invested: s.invested ?? null,
        recurringBuy: s.recurring
          ? {
              running: s.recurring.live ? termsPhrase(s.recurring.live) : null,
              waitingForApproval: s.recurring.pending ? termsPhrase(s.recurring.pending) : null,
              realBuys: s.recurring.realRuns,
            }
          : null,
      },
    };
  },
};

const getRecurringBuy: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "get_recurring_buy",
      description:
        "Read the room's recurring ETH buy: the one running (week k of N, weeks bought, dollars invested, WETH accumulated, average price, this week's state, next buy), a request waiting for approvals, and the history of weekly buys and skips. Shows its card to the member.",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const s = await recurringBuyStatus(ctx.roomId);
    const cardId = s.live?.actionId ?? s.pending?.actionId;
    const surface = cardId ? await recurringBuySurfaceFor(ctx.roomId, cardId, ctx.askerId, ctx.t) : null;
    return {
      result: {
        ok: true,
        running: s.live,
        waitingForApproval: s.pending,
        history: s.history.slice(0, 8).map((h) => ({
          ...h,
          ...(h.reason ? { reasonText: SKIP_REASON_TEXT[h.reason] } : {}),
        })),
        realBuys: s.realRuns,
        realBuysNote: s.realRuns ? "buys move real USDC on Base" : "real buys are off on this server; a run is a rehearsal",
        cardShown: Boolean(surface),
      },
      ...(surface && cardId ? { surface, cardActionId: cardId } : {}),
    };
  },
};

const listActivity: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "list_activity",
      description: "List the treasury's recent activity, newest first: payments, investments, rule adoptions, recurring-buy requests, weekly buys and skips.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 20, description: "how many entries (default 10)" } },
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const limit = Math.min(20, Math.max(1, Number.isInteger(args.limit) ? (args.limit as number) : 10));
    const rows = await db
      .select()
      .from(treasuryActions)
      .where(eq(treasuryActions.roomId, ctx.roomId))
      .orderBy(desc(treasuryActions.createdAt))
      .limit(limit);
    const now = Date.now();
    return {
      result: {
        ok: true,
        activity: rows.map((a) => ({
          at: (a.decidedAt ?? a.createdAt).toISOString(),
          line: describeTreasuryAction(a, now),
          ...(a.txHash ? { txHash: a.txHash } : {}),
        })),
      },
    };
  },
};

const INVEST_KINDS: TreasuryKind[] = ["expense", "investment", "withdrawal"];

const explainRules: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "explain_rules",
      description:
        "Read the relation's ADOPTED Treasury Rules (the ones enforced), when they were adopted, who votes, and edits nobody adopted yet. With amount_usd (and kind), also says what those rules require for that amount: automatic, N verified approvals, forbidden, or more than the pot holds. A recurring buy is judged as an investment of its total (weekly × weeks).",
      parameters: {
        type: "object",
        properties: {
          amount_usd: { type: "number", exclusiveMinimum: 0, description: "an amount to judge against the rules" },
          kind: { type: "string", enum: INVEST_KINDS, description: "what the money is for (default investment)" },
        },
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const treasury = await loadRelationTreasury(ctx.roomId);
    if (!treasury) return { result: { ok: true, enabled: false, note: "This room has no treasury." } };
    const names = treasury.electorate.length
      ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, treasury.electorate))
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const result: Record<string, unknown> = {
      ok: true,
      adopted: treasury.adoptedAt !== null,
      adoptedAt: treasury.adoptedAt,
      rules: treasury.policy.rules.map((r) => r.text),
      unreadableRules: treasury.policy.unparsed,
      payees: treasury.payees.map((p) => p.name),
      voters: treasury.electorate.map((id) => nameOf.get(id) ?? "a member"),
      unadoptedChanges: treasury.proposal
        ? { added: treasury.proposal.added, removed: treasury.proposal.removed, joined: treasury.proposal.joined.length }
        : null,
      note: treasury.adoptedAt ? undefined : "The rules were never adopted, so the agent moves no money yet.",
    };
    const amount = typeof args.amount_usd === "number" && Number.isFinite(args.amount_usd) && args.amount_usd > 0 ? args.amount_usd : null;
    if (amount !== null) {
      const kind = INVEST_KINDS.includes(args.kind as TreasuryKind) ? (args.kind as TreasuryKind) : "investment";
      // the share rules ("more than 30% of the treasury") need the pot; unread, they can't be applied
      const pot = await ensureAgentWallet(ctx.agentUserId)
        .then((w) => treasuryBalance(w.address))
        .then((b) => b.usd)
        .catch(() => null);
      // judged as if the pot held at least the amount (as recurring.ts judges an authority), so a
      // short pot still says which bar applies; whether the pot covers it is reported beside it
      const d = evaluateCommand({
        policy: treasury.policy,
        kind,
        amountUsd: amount,
        personal: false,
        balanceUsd: pot === null ? Number.MAX_SAFE_INTEGER : Math.max(pot, amount),
      });
      result.judged = {
        kind,
        amountUsd: amount,
        potUsd: pot,
        potCoversIt: pot === null ? null : pot >= amount,
        outcome: d.outcome,
        ...(d.outcome === "approval" ? { required: d.required, rule: d.rule.text } : {}),
        ...(d.outcome === "auto" ? { rule: d.rule.text } : {}),
        ...(d.outcome === "forbidden" ? { rule: d.rule?.text ?? null, reason: d.reason } : {}),
      };
    }
    return { result };
  },
};

const proposeRecurring: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "propose_recurring_buy",
      description:
        "Queue a recurring ETH buy for the members' approval: weekly_usd of USDC swapped to WETH on Base via Uniswap v3, once per ISO week, for `weeks` weeks, from the agent's own wallet. This moves NO money: it creates a request that verified members must approve with World ID, as many as the adopted rules require. Call it only when the member asks to set one up in this message, with both numbers stated or confirmed.",
      parameters: {
        type: "object",
        properties: {
          weekly_usd: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "dollars per week (at most 2 decimals)" },
          weeks: { type: "integer", minimum: 1, maximum: 52, description: "how many weeks, 1 to 52" },
        },
        required: ["weekly_usd", "weeks"],
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    if (!(await electorate(ctx.roomId)).includes(ctx.askerId)) return { result: NOT_VOTER };
    const weeklyUsd = Number(args.weekly_usd);
    const weeks = Number(args.weeks);
    const proposed = await proposeRecurringBuy({
      roomId: ctx.roomId,
      agentUserId: ctx.agentUserId,
      requesterId: ctx.askerId,
      weeklyUsd,
      weeks,
    });
    if (!proposed.ok) return { result: { ok: false, refused: proposed.reason } };
    const { terms } = proposed.record;
    const total = usd(authorityExposure(proposed.record));
    const humans = `${proposed.required} verified human${proposed.required === 1 ? "" : "s"}`;
    await postAsAgent(
      ctx,
      `Queued at ${ctx.askerName}'s request: a recurring buy — ${usd(terms.weeklyUsd)} of ETH every week for ${terms.weeks} week${terms.weeks === 1 ? "" : "s"}, until ${whenUtc(terms.expiresAt)}. It swaps USDC → WETH on Base through Uniswap v3 from my own wallet ${shortAddress(terms.agentAddress)}, at most ${total} in all. Our rule “${proposed.rule}” means it needs ${humans} — approve it with World ID on the card.\n${recurringBuyMarker(proposed.actionId)}`
    );
    const surface = await recurringBuySurfaceFor(ctx.roomId, proposed.actionId, ctx.askerId, ctx.t);
    return {
      result: {
        ok: true,
        queued: true,
        movedMoney: false,
        terms: termsPhrase(terms),
        atMostUsd: authorityExposure(proposed.record),
        until: whenUtc(terms.expiresAt),
        requiredApprovals: proposed.required,
        rule: proposed.rule,
        postedToRoom: "the proposal card, so every member can approve it",
      },
      ...(surface ? { surface, cardActionId: proposed.actionId } : {}),
    };
  },
};

const stopRecurring: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "stop_recurring_buy",
      description:
        "Stop the room's running recurring buy (no vote needed — stopping only narrows what the agent may do), or withdraw one still waiting for approval. Call it only when the member asks to stop, cancel or pause it in this message.",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const stopped = await stopAndAnnounce(ctx);
    if (!stopped.ok) return { result: { ok: false, refused: stopped.reason } };
    const surface = await recurringBuySurfaceFor(ctx.roomId, stopped.actionId, ctx.askerId, ctx.t);
    return {
      result: { ok: true, done: stopped.line, toldTheRoom: true },
      ...(surface ? { surface, cardActionId: stopped.actionId } : {}),
    };
  },
};

const buyThisWeek: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "buy_this_week",
      description:
        "Run this week's buy under the recurring buy the members ADOPTED: at most once per ISO week, exactly its weekly amount, only while it runs and our rules still allow it. It decides by itself whether to buy or skip; with real buys off it is a rehearsal that moves nothing. Call it only when the member asks to buy this week's ETH or run the recurring buy now.",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    if (!(await electorate(ctx.roomId)).includes(ctx.askerId)) return { result: NOT_VOTER };
    let ran: Awaited<ReturnType<typeof runAndAnnounce>>;
    try {
      ran = await runAndAnnounce(ctx);
    } catch (err) {
      if (err instanceof RecurringBuyRefusal) return { result: { ok: false, refused: err.message } };
      throw err;
    }
    const { run, line } = ran;
    switch (run.outcome) {
      case "none":
        return { result: { ok: false, refused: "There's no adopted recurring buy in this room — nothing was bought." } };
      case "rehearsal":
        return {
          result: {
            ok: true,
            outcome: "rehearsal",
            movedMoney: false,
            line: `Rehearsal: I would buy ${usd(run.wouldBuyUsd)} of ETH for ${run.isoWeek} — real buys are off on this server.`,
          },
        };
      case "skipped":
        return {
          result: {
            ok: true,
            outcome: "skipped",
            movedMoney: false,
            isoWeek: run.isoWeek,
            reason: run.reason,
            line: `Skipped this week (${SKIP_REASON_TEXT[run.reason]} — ${run.isoWeek}).`,
          },
        };
      case "bought":
        return {
          result: { ok: true, outcome: "bought", movedMoney: true, isoWeek: run.isoWeek, usdcIn: run.usdcIn, wethOut: run.wethOut, txUrl: run.txUrl, line },
        };
    }
  },
};

export const TREASURER_TOOLS: TreasurerTool[] = [
  getTreasuryStatus,
  getRecurringBuy,
  listActivity,
  explainRules,
  proposeRecurring,
  stopRecurring,
  buyThisWeek,
];

export const TOOL_DEFS: AiTool[] = TREASURER_TOOLS.map((tool) => tool.def);

const BY_NAME = new Map(TREASURER_TOOLS.map((tool) => [tool.def.function.name, tool]));

export function isTreasurerTool(name: string): boolean {
  return BY_NAME.has(name);
}

/** Runs one call. Arguments that don't parse are refused, not guessed at. */
export async function runTreasurerTool(name: string, rawArgs: string, ctx: TreasurerContext): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) return { result: { ok: false, error: `no tool named ${name}` } };
  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { result: { ok: false, error: "the arguments were not valid JSON" } };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { result: { ok: false, error: "the arguments must be an object" } };
  return tool.run(args as Record<string, unknown>, ctx);
}

