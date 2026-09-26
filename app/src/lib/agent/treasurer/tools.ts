import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { formatUnits } from "viem";
import { db } from "@/lib/db";
import { chatRoomBots, treasuryActions, treasuryApprovals, treasurySeats, users } from "@/lib/db/schema";
import { idpMode } from "@/lib/auth/world";
import type { AiTool } from "@/lib/ai";
import type { T } from "@/i18n";
import type { A2uiMessage } from "@/lib/x402/a2ui";
import { treasuryStatus, voters } from "@/lib/agent/treasury/approvals";
import { collectDueContributions, storyUsd, type CollectResult } from "@/lib/agent/treasury/contributions";
import { investConfig, usdcForUsd } from "@/lib/agent/treasury/invest";
import { humanMemberIds, latestAdoption, loadRelationTreasury } from "@/lib/agent/treasury/memory";
import { evaluateCommand } from "@/lib/agent/treasury/policy";
import {
  RecurringBuyRefusal,
  authorityExposure,
  boughtLine,
  proposeRecurringBuy,
  queuedLines,
  recurringBuyStatus,
  roomRecurringBuys,
  runRecurringBuy,
  stopRecurringBuy,
  termsPhrase,
  wethShort,
  type RecurringRunResult,
} from "@/lib/agent/treasury/recurring";
import { SKIP_REASON_TEXT, lastDayOf, relationDay, termsDigest } from "@/lib/agent/treasury/recurring-record";
import { describeTreasuryAction } from "@/lib/agent/treasury/summary";
import { RECURRING_BUY_KIND, type TreasuryKind } from "@/lib/agent/treasury/types";
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
 * asker's screen; `cardShown` in a result is the model's only evidence that a
 * card (and its buttons) is on screen. Dates reach the model as days on the
 * relation's calendar ("Sun, Sep 27"), never as ISO strings it would repeat.
 * What the room sees (a proposal card, a buy, a stop) is posted here as the
 * agent's own message, in fixed English.
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

export async function isHumanMember(roomId: string, userId: string): Promise<boolean> {
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

/**
 * What one weekly buy really swaps, in whole USDC ("0.1"): the story's dollars
 * at the demo scale invest.ts buys at — the same scale when investing is off.
 */
function realUsdcPerWeek(weeklyUsd: number): string {
  const envScale = Number(process.env.TREASURY_INVEST_USDC_PER_USD ?? "0.005");
  const cfg = investConfig() ?? { rpcs: [], slippageBps: 0, usdcPerUsd: envScale > 0 ? envScale : 0.005 };
  return formatUnits(usdcForUsd(cfg, weeklyUsd), 6);
}

/** "Sun, Sep 27" — how a date reaches the model, so an answer never repeats an ISO timestamp */
function day(at: string | Date, withYear = false): string {
  return relationDay(at, withYear);
}

async function postAsAgent(ctx: Pick<TreasurerContext, "roomId" | "agentUserId">, text: string): Promise<void> {
  await postRoomMessage({ roomId: ctx.roomId, authorId: ctx.agentUserId, text, privateToUserId: null, byAgent: true }).catch(
    (err: unknown) => console.error("treasurer: posting to the room failed:", err)
  );
}

// ── the recurring-buy card ──────────────────────────────────────────────────

/**
 * The card for one recurring-buy action as `viewerId` sees it now, or null
 * when the room has no such action. Reads only the database.
 */
/** Who may approve in this room right now (approvals.ts voters: the electorate, still a member, seated), by name, in the room's order. */
async function voterNamesOf(roomId: string, electorateIds: string[]): Promise<string[]> {
  const can = await voters(roomId, electorateIds);
  if (!can.size) return [];
  const ordered = (await humanMemberIds(roomId)).filter((id) => can.has(id));
  const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ordered));
  const name = new Map(rows.map((r) => [r.id, r.name]));
  return ordered.map((id) => name.get(id) ?? "").filter(Boolean);
}

export async function recurringBuySurfaceFor(
  roomId: string,
  actionId: string,
  viewerId: string,
  t: T,
  notice?: string
): Promise<A2uiMessage[] | null> {
  const authority = (await roomRecurringBuys(roomId)).find((a) => a.actionId === actionId);
  if (!authority) return null;
  const [status, members, electorateIds, seat, mine] = await Promise.all([
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
          : record.revokedAt !== undefined
            ? "cancelled"
            : "closed";
  return recurringBuySurface(
    {
      actionId,
      roomId,
      state,
      weeklyUsd: record.terms.weeklyUsd,
      weeks: record.terms.weeks,
      exposureUsd: authorityExposure(record),
      usdcPerWeek: realUsdcPerWeek(record.terms.weeklyUsd),
      approvals: authority.approvals,
      required: authority.required,
      approvedBy: authority.approvedBy,
      voterNames: await voterNamesOf(roomId, electorateIds),
      canApprove: state === "pending" && seat.length > 0 && electorateIds.includes(viewerId) && mine.length === 0,
      approveBlocked:
        state !== "pending"
          ? undefined
          : mine.length > 0
            ? "approved"
            : seat.length === 0
              ? "unseated"
              : !electorateIds.includes(viewerId)
                ? "not-voting"
                : undefined,
      approvalsOpen: idpMode() !== null,
      canStop: members.includes(viewerId),
      progress: live
        ? {
            weekIndex: live.weekIndex,
            boughtWeeks: live.boughtWeeks,
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
 * `wasLive`: a running one was stopped (else a waiting request was cancelled);
 * `terms`: "$20 of ETH weekly for 12 weeks", when it could be read.
 */
export async function stopAndAnnounce(
  ctx: TreasurerContext
): Promise<{ ok: true; actionId: string; line: string; wasLive: boolean; terms: string | null } | { ok: false; reason: string }> {
  const before = await recurringBuyStatus(ctx.roomId);
  const stopped = await stopRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  if (!stopped.ok) return stopped;
  const wasLive = before.live?.actionId === stopped.actionId;
  const terms = wasLive ? before.live : before.pending;
  const phrase = terms ? ` (${termsPhrase(terms)})` : "";
  const line = wasLive
    ? `Stopped the recurring buy${phrase} at ${ctx.askerName}'s request.\nI won't buy again under it.`
    : `Cancelled the recurring buy request${phrase} at ${ctx.askerName}'s request — it won't be adopted.`;
  await postAsAgent(ctx, line);
  return { ok: true, actionId: stopped.actionId, line, wasLive, terms: terms ? termsPhrase(terms) : null };
}

/**
 * Runs this week's buy for `ctx.askerId` and tells the room when money moved.
 * Shared by the buy tool and the panel's button, so both leave the same trace.
 * Throws a RecurringBuyRefusal when the asker may not direct the treasury.
 */
export async function runAndAnnounce(ctx: TreasurerContext): Promise<{ run: RecurringRunResult; line: string | null }> {
  // the members' contributions that are due come in first, so this week's buy can use them
  await collectAndAnnounce(ctx).catch((err: unknown) => console.error("treasurer: collecting contributions failed:", err));
  const run = await runRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  if (run.outcome !== "bought") return { run, line: null };
  const line = boughtLine(run, ctx.askerName);
  await postAsAgent(ctx, line);
  return { run, line };
}

/**
 * Collects the members' contributions that are due (one Permit2 pull per plan) and tells the room
 * what came in. Shared by the weekly run and the collect route (a member's button, and the last step
 * of starting a plan), so both leave the same trace. Collects nothing unless real runs are on.
 */
export async function collectAndAnnounce(
  ctx: Pick<TreasurerContext, "roomId" | "agentUserId">,
  expect?: `0x${string}`
): Promise<CollectResult & { line: string | null }> {
  const result = await collectDueContributions({ roomId: ctx.roomId, agentUserId: ctx.agentUserId, expect });
  if (result.collected.length === 0) return { ...result, line: null };
  const perUsd = investConfig()?.usdcPerUsd ?? 0.005;
  const each = result.collected.map((c) => `${c.name} ${c.amount} USDC (${storyUsd(c.amount, perUsd)})`).join(", ");
  const line = `Collected this period's contributions through Permit2: ${each}. They're in the pot on Base.`;
  await postAsAgent(ctx, line);
  return { ...result, line };
}

// ── the tools ───────────────────────────────────────────────────────────────

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const getTreasuryStatus: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "get_treasury_status",
      description:
        "Reads the treasury as it is now: the pot's balance, whether the rules are adopted, the members and who votes, each request waiting for approval (whether this member can approve it, and where), invested funds, and the recurring buy in one line. Use it for “how much do we have?”, “what's waiting for approval?”, “who can vote?”. When a recurring buy waits for this member's approval, its card with the Approve button is shown too (cardShown). Not for the rules' wording (explain_rules) or the recurring buy's weeks and history (get_recurring_buy).",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const s = await treasuryStatus(ctx.roomId, ctx.askerId);
    if (!s.enabled) return { result: { ok: true, enabled: false, note: "This room has no Treasury Rules section, so it has no treasury." } };
    const waiting = s.actions.filter((a) => a.status === "pending");
    const votes = s.members.find((m) => m.userId === ctx.askerId)?.voting ?? false;
    // the decision this member can make from the chat: the waiting recurring buy's card carries its Approve button
    const approvable = waiting.find((a) => a.kind === RECURRING_BUY_KIND && a.canApprove) ?? null;
    const surface = approvable ? await recurringBuySurfaceFor(ctx.roomId, approvable.id, ctx.askerId, ctx.t) : null;
    return {
      result: {
        ok: true,
        enabled: true,
        balance: s.balanceUsd === null ? "can't be read right now" : usd(s.balanceUsd),
        agentAddress: s.address,
        rulesAdoptedOn: s.adoptedAt ? day(s.adoptedAt, true) : null,
        unadoptedChanges: s.proposal ? { added: s.proposal.added, removed: s.proposal.removed, joined: s.proposal.joined.length } : null,
        members: s.members.map((m) => ({ name: m.displayName, votes: m.voting, seated: m.seated })),
        waitingForApproval: waiting.map((a) => ({
          what:
            a.kind === RECURRING_BUY_KIND && s.recurring?.pending?.actionId === a.id
              ? `a recurring buy of ${termsPhrase(s.recurring.pending)}`
              : a.memo,
          amountUsd: a.amountUsd,
          ...(a.recipient?.label ? { to: a.recipient.label } : {}),
          approvals: `${a.approvals.length} of ${a.requiredApprovals}`,
          approvedBy: a.approvals.map((p) => p.displayName),
          rule: a.ruleText,
          requestedBy: a.requestedBy.displayName,
          youCanApprove: a.canApprove,
          ...(a.canApprove
            ? {
                approveOn:
                  a.id === approvable?.id && surface
                    ? "the card shown with this answer"
                    : a.kind === RECURRING_BUY_KIND
                      ? "its card (get_recurring_buy shows it)"
                      : "the Treasury page's Home tab",
              }
            : {
                // as the Treasury home's approvals card says it
                cantApprove: a.approvals.some((p) => p.userId === ctx.askerId)
                  ? "you already approved it"
                  : !s.mySeated
                    ? "claim your vote in the room first"
                    : !votes
                      ? "you joined after our rules were adopted"
                      : "it can't take approvals right now",
              }),
          ...(a.expiresAt ? { expires: day(a.expiresAt) } : {}),
        })),
        invested: s.invested ? { weth: wethShort(s.invested.weth), worthUsd: s.invested.storyUsd } : null,
        recurringBuy: s.recurring
          ? {
              running: s.recurring.live ? termsPhrase(s.recurring.live) : null,
              waitingForApproval: s.recurring.pending ? termsPhrase(s.recurring.pending) : null,
            }
          : null,
        cardShown: Boolean(surface),
      },
      ...(surface && approvable ? { surface, cardActionId: approvable.id } : {}),
    };
  },
};

const getRecurringBuy: TreasurerTool = {
  def: {
    type: "function",
    function: {
      name: "get_recurring_buy",
      description:
        "Reads the room's recurring ETH buy and shows its card, with its Approve or Stop button, on the member's screen: the one running (week k of N, weeks bought, dollars in, WETH bought, when the next week opens), a request waiting for approvals, and the recent weekly buys and skips. A week's buy runs only when a member asks for it (buy_this_week), at most once a week — nothing runs on a timer. Use it for “how's the recurring buy doing?”, “show me the recurring buy”. Not for the pot's balance (get_treasury_status).",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const s = await recurringBuyStatus(ctx.roomId);
    const cardId = s.live?.actionId ?? s.pending?.actionId;
    const surface = cardId ? await recurringBuySurfaceFor(ctx.roomId, cardId, ctx.askerId, ctx.t) : null;
    const { live, pending } = s;
    return {
      result: {
        ok: true,
        running: live
          ? {
              terms: termsPhrase(live),
              realSwapPerWeek: `${realUsdcPerWeek(live.weeklyUsd)} USDC → WETH`,
              week: `${live.weekIndex} of ${live.weeks}`,
              weeksBought: live.boughtWeeks,
              investedUsd: live.investedUsd,
              wethBought: wethShort(live.wethOut),
              avgPriceUsdPerEth: live.avgPriceUsdcPerEth,
              thisWeek: live.thisWeek,
              nextWeekOpens: live.nextRunAt ? day(live.nextRunAt) : null,
              lastDay: day(lastDayOf(Date.parse(live.expiresAt) / 1000), true),
              approvedBy: live.approvedBy,
              rule: live.rule,
            }
          : null,
        waitingForApproval: pending
          ? {
              terms: termsPhrase(pending),
              realSwapPerWeek: `${realUsdcPerWeek(pending.weeklyUsd)} USDC → WETH`,
              atMostUsd: pending.exposureUsd,
              approvals: `${pending.approvals} of ${pending.required}`,
              rule: pending.rule,
              expires: day(pending.expiresAt),
            }
          : null,
        recentWeeks: s.history.slice(0, 8).map((h) => ({
          on: day(h.at),
          outcome: h.outcome,
          ...(h.reason ? { why: SKIP_REASON_TEXT[h.reason] } : {}),
          ...(h.wethOut ? { wethBought: wethShort(h.wethOut) } : {}),
          ...(h.txUrl ? { txUrl: h.txUrl } : {}),
        })),
        realBuys: s.realRuns,
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
      description:
        "Lists the treasury's recent activity, newest first, one line each with its day: payments, investments, rule adoptions, recurring-buy requests, weekly buys and skips. Use it for “what happened recently?”, “did we pay the hotel?”. Not for what is waiting right now (get_treasury_status).",
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
          on: day(a.decidedAt ?? a.createdAt),
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
        "Reads the relation's ADOPTED Treasury Rules (the ones enforced), when they were adopted, who votes, and doc edits nobody adopted yet. With amount_usd (and kind), also judges that amount against them: automatic, N verified approvals, forbidden, or more than the pot holds — a recurring buy counts as an investment of its total (weekly × weeks). Use it for “what are our rules?”, “what would $300 for the hotel need?”. It moves and queues nothing.",
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
      adoptedOn: treasury.adoptedAt ? day(treasury.adoptedAt, true) : null,
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
        "Queues a recurring ETH buy for the members' approval: weekly_usd of USDC swapped to WETH with Uniswap v3 on Base, at most once a week, for `weeks` weeks, from the agent's own wallet. It moves NO money: it creates a request that as many verified members as the adopted rules require must approve with World ID; its card with the Approve button goes on this member's screen and into the room. Call it only when the member's latest message asks to set one up with both numbers stated — if one is missing, ask instead. Refused while another recurring buy runs or waits.",
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
    const lines = queuedLines({ record: proposed.record, required: proposed.required, rule: proposed.rule, askedBy: ctx.askerName });
    await postAsAgent(ctx, [...lines, recurringBuyMarker(proposed.actionId)].join("\n"));
    const surface = await recurringBuySurfaceFor(ctx.roomId, proposed.actionId, ctx.askerId, ctx.t);
    return {
      result: {
        ok: true,
        queued: termsPhrase(terms),
        movedMoney: false,
        atMostUsd: authorityExposure(proposed.record),
        through: day(lastDayOf(terms.expiresAt), true),
        requiredApprovals: proposed.required,
        rule: proposed.rule,
        alsoPostedToRoom: true,
        cardShown: Boolean(surface),
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
        "Stops the room's running recurring buy, or cancels one still waiting for approval — no vote needed, since stopping only narrows what the agent may do; the room is told. Call it only when the member's latest message asks to stop, cancel, pause or withdraw it. Starting again takes a new request and new approvals.",
      parameters: NO_ARGS,
    },
  },
  async run(_args, ctx) {
    if (!(await isHumanMember(ctx.roomId, ctx.askerId))) return { result: NOT_MEMBER };
    const stopped = await stopAndAnnounce(ctx);
    if (!stopped.ok) return { result: { ok: false, refused: stopped.reason } };
    const surface = await recurringBuySurfaceFor(ctx.roomId, stopped.actionId, ctx.askerId, ctx.t);
    return {
      result: {
        ok: true,
        // the room's line names the asker in the third person; the asker is told in their own terms
        what: stopped.wasLive ? "stopped" : "cancelled",
        terms: stopped.terms,
        ...(stopped.wasLive ? { noMoreBuys: true } : { willNeverRun: true }),
        toldTheRoom: true,
        cardShown: Boolean(surface),
      },
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
        "Runs this week's buy under the recurring buy the members ADOPTED: exactly its weekly amount, at most once a week, only while it runs and our rules still allow it; the server decides whether to buy or skip. Where real buys are off it is a rehearsal that moves nothing. Call it only when the member's latest message asks to buy this week's ETH or run the recurring buy now.",
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
            line: `Rehearsal: this week's buy would be ${usd(run.wouldBuyUsd)} of ETH. Nothing moved.`,
          },
        };
      case "skipped":
        return {
          result: {
            ok: true,
            outcome: "skipped",
            movedMoney: false,
            reason: run.reason,
            line: `Skipped this week: ${SKIP_REASON_TEXT[run.reason]}.`,
          },
        };
      case "bought":
        return {
          result: { ok: true, outcome: "bought", movedMoney: true, usdcIn: run.usdcIn, wethOut: run.wethOut, txUrl: run.txUrl, line },
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
