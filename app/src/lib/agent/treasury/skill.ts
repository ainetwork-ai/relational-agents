import "server-only";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, treasuryActions, treasuryApprovals, treasurySeats, users } from "@/lib/db/schema";
import { matchTreasuryCommand, mentionsMoney, mentionsRecurringMoney } from "./match";
import { evaluateCommand } from "./policy";
import { appendTreasuryActivity, loadRelationTreasury } from "./memory";
import { ensureAgentWallet, treasuryBalance, USD_PER_ETH } from "./wallet";
import { createTreasuryAction, executeIfQuorum } from "./approvals";
import {
  boughtLine,
  logLine,
  proposeRecurringBuy,
  queuedLines,
  RecurringBuyRefusal,
  recurringBuyStatus,
  runRecurringBuy,
  stopRecurringBuy,
  wethShort,
} from "./recurring";
import { relationDay, SKIP_REASON_TEXT } from "./recurring-record";
import { recurringBuyMarker } from "@/lib/agent/treasurer/surfaces";
import {
  RATIFY_KIND,
  RECURRING_BUY_KIND,
  RECURRING_RUN_KIND,
  REQUEST_TTL_MS,
  type Payee,
  type RatifiedText,
  type RelationTreasury,
  type TreasuryCommand,
  type TreasuryKind,
  type TreasuryRule,
} from "./types";

/**
 * The agent's side of the Relation Treasury in chat. A money sentence
 * addressed to the agent is answered here, before any model is consulted:
 * the command is matched by shape, the recipient is looked up in what the
 * relation agreed (Payees, members' wallets), and the relation's own rules
 * decide — refuse, execute, or wait for verified humans. Every reply is a
 * template, so what the agent says about money is exactly what the code did.
 */

export interface TreasuryCommandContext {
  roomId: string;
  agentUserId: string;
  askerId: string;
  text: string;
  agentName: string;
}

type MoneyCommand = Extract<TreasuryCommand, { kind: TreasuryKind }>;

/** Payments the agent makes on its own, per room per rolling hour — each one also
 *  spends the relayer's gas, so "pay $0.01" in a loop must run out somewhere. */
const AUTO_PER_HOUR = Number(process.env.TREASURY_AUTO_PER_HOUR ?? 10);

interface Member {
  userId: string;
  displayName: string;
  address: `0x${string}` | null;
}

interface Recipient {
  /** how the reply names it: a payee's name, or "<member>'s wallet" */
  label: string;
  address: `0x${string}` | null;
  userId: string | null;
  /** money would land in a member's own wallet */
  personal: boolean;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function evmAddress(raw: string | null | undefined): `0x${string}` | null {
  return raw && EVM_ADDRESS.test(raw) ? (raw as `0x${string}`) : null;
}

// ── formatting ──────────────────────────────────────────────────────────────

function usd(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

function humans(n: number): string {
  return `${n} verified human${n === 1 ? "" : "s"}`;
}

function membersWord(n: number): string {
  return `${n} verified member${n === 1 ? "" : "s"}`;
}

/** the Treasury Activity's request line: "needs 2 humans to approve" */
function toApprove(n: number): string {
  return `needs ${n} human${n === 1 ? "" : "s"} to approve`;
}

/** a sentence that ends like one — rule bullets usually carry their own period */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?”"]$/.test(t) ? t : `${t}.`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The Purpose section as one line: bullets arrive one per line. */
function purposeLine(purpose: string): string {
  return purpose
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function purposeClause(t: RelationTreasury): string | null {
  const p = purposeLine(t.purpose);
  return p ? `We agreed what this money is for: “${p}”` : null;
}

function rulesLink(t: RelationTreasury): string | null {
  return t.rulesPageId ? `Rules: /p/${t.rulesPageId}` : null;
}

/** "85.4" — one decimal, so $304 of $1,000 reads 30.4% next to a "more than 30%" rule, not 30% */
function sharePct(amountUsd: number, balanceUsd: number): string | null {
  if (balanceUsd <= 0) return null;
  const pct = Math.round((amountUsd / balanceUsd) * 1000) / 10;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/** One sentence when the doc says something the agent is not following yet. */
function unadoptedNote(t: RelationTreasury): string | null {
  const p = t.proposal;
  if (!p || !t.adoptedAt) return null;
  if (!p.added.length && !p.removed.length && !p.reordered) return null;
  return "(Our memory doc has edits to the rules or payees nobody has adopted yet — I follow the version we adopted. “@agent adopt the new rules” puts them to a vote.)";
}

/** " (hotel deposit)" — unless the memo only restates the recipient ("hotel", "Bea") */
function memoNote(memo: string, label: string): string {
  const named = tokens(label);
  return [...tokens(memo)].some((w) => !named.has(w)) ? ` (${memo})` : "";
}

/** "$180 to Hotel Gracery Shinjuku (hotel deposit)" */
function destination(amountUsd: number, r: Recipient, memo: string): string {
  return `${usd(amountUsd)} to ${r.label}${memoNote(memo, r.label)}`;
}

// ── who the money would go to ───────────────────────────────────────────────

const FILLER = new Set(
  "the a an and or of to in on at for with from our my your their this that it is be pay paid send book please".split(" ")
);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !FILLER.has(w))
  );
}

/**
 * The agreed payee the memo names: most words that name ONE payee wins. A word
 * two payees share ("hotel" for two hotels) tells them apart for no one, and a
 * tie is no answer — both mean "which one?", never the doc's first line.
 */
function payeeNamed(memo: string, payees: Payee[]): Payee | null {
  const said = tokens(memo);
  const uses = new Map<string, number>();
  for (const p of payees) for (const w of tokens(p.name)) uses.set(w, (uses.get(w) ?? 0) + 1);
  let best: Payee | null = null;
  let bestScore = 0;
  let tied = false;
  for (const p of payees) {
    let score = 0;
    for (const w of tokens(p.name)) if (said.has(w) && uses.get(w) === 1) score++;
    if (score > bestScore) {
      best = p;
      bestScore = score;
      tied = false;
    } else if (score > 0 && score === bestScore) tied = true;
  }
  return tied ? null : best;
}

// "invest $300 of the idle funds" names no payee; a payee the relation
// explicitly labelled as where savings go ("Savings (Aave): 0x…", "Vault
// (savings): 0x…") is the only place idle funds may be sent — a name that
// merely contains "pool" ("Pool Bar Shinjuku") is not that label.
const INVESTMENT_PAYEE = /^(?:savings|investments?|idle funds)\b|\((?:savings|investments?|idle funds)\)/i;

/** The member a memo names by first name ("Bea's wallet") — "Alex" over "Alex (2nd account)" unless the memo says more. */
function memberNamed(memo: string, members: Member[]): Member | null {
  const said = tokens(memo);
  let best: Member | null = null;
  let bestScore = 0;
  for (const m of members) {
    const name = [...tokens(m.displayName)];
    if (!name.length || !said.has(name[0])) continue;
    const score = name.filter((w) => said.has(w)).length;
    if (score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

/** Does the memo say nothing but a member's name ("pay Bea $30")? */
function onlyNamesMember(memo: string, m: Member): boolean {
  const said = [...tokens(memo)];
  const name = tokens(m.displayName);
  return said.length > 0 && said.every((w) => name.has(w));
}

function resolveRecipient(
  cmd: MoneyCommand,
  asker: Member,
  members: Member[],
  payees: Payee[]
): Recipient | null {
  if (cmd.toSelf)
    return { label: `${asker.displayName}'s wallet`, address: asker.address, userId: asker.userId, personal: true };

  const toMember = (m: Member): Recipient => ({
    label: `${m.displayName}'s wallet`,
    address: m.address,
    userId: m.userId,
    personal: true,
  });
  const toPayee = (p: Payee): Recipient => {
    // an agreed payee that is really a member's own wallet is still personal
    const owner = members.find((m) => m.address?.toLowerCase() === p.address.toLowerCase());
    return { label: p.name, address: p.address, userId: owner?.userId ?? null, personal: Boolean(owner) };
  };

  const payee =
    payeeNamed(cmd.memo, payees) ??
    (cmd.kind === "investment" ? payees.find((p) => INVESTMENT_PAYEE.test(p.name)) ?? null : null);
  const named = memberNamed(cmd.memo, members);
  // a withdrawal, or anything said to go to a "wallet", is about a person first
  if (named && (cmd.kind === "withdrawal" || /\bwallet\b/i.test(cmd.memo))) return toMember(named);
  if (payee) return toPayee(payee);
  if (named && onlyNamesMember(cmd.memo, named)) return toMember(named);
  return null;
}

// ── room facts ──────────────────────────────────────────────────────────────

async function roomHumans(roomId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      ainAddress: users.ainAddress,
      isAgent: users.isAgent,
    })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(eq(chatRoomMembers.roomId, roomId))
    .orderBy(asc(chatRoomMembers.joinedAt), asc(chatRoomMembers.userId));
  return rows
    .filter((r) => !r.isAgent)
    .map((r) => ({ userId: r.userId, displayName: r.displayName, address: evmAddress(r.ainAddress) }));
}

async function seatedUserIds(roomId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: treasurySeats.userId })
    .from(treasurySeats)
    .where(eq(treasurySeats.roomId, roomId));
  return new Set(rows.map((r) => r.userId));
}

// ── replies ─────────────────────────────────────────────────────────────────

async function statusReply(t: RelationTreasury, roomId: string, balance: { eth: string; usd: number }): Promise<string> {
  const perDollar = (1 / USD_PER_ETH).toFixed(12).replace(/\.?0+$/, "");
  const eth = Number(balance.eth).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const out = [
    `Our treasury holds ${usd(balance.usd)} (${eth} SepETH on Sepolia; demo scale $1 = ${perDollar} SepETH).`,
  ];
  const purpose = purposeClause(t);
  if (purpose) out[0] += ` ${purpose}`;

  const pending = await db
    .select({
      id: treasuryActions.id,
      kind: treasuryActions.kind,
      amountUsd: treasuryActions.amountUsd,
      memo: treasuryActions.memo,
      requiredApprovals: treasuryActions.requiredApprovals,
    })
    .from(treasuryActions)
    .where(
      and(
        eq(treasuryActions.roomId, roomId),
        eq(treasuryActions.status, "pending"),
        // a lapsed request is swept by the panel's next poll; it is not waiting any more
        gt(treasuryActions.createdAt, new Date(Date.now() - REQUEST_TTL_MS))
      )
    )
    .orderBy(desc(treasuryActions.createdAt))
    .limit(5);
  if (!pending.length) {
    out.push("Nothing is waiting for approval.");
  } else {
    const counts = new Map(
      (
        await db
          .select({ actionId: treasuryApprovals.actionId, n: sql<number>`count(*)::int` })
          .from(treasuryApprovals)
          .where(inArray(treasuryApprovals.actionId, pending.map((p) => p.id)))
          .groupBy(treasuryApprovals.actionId)
      ).map((r) => [r.actionId, Number(r.n)] as const)
    );
    out.push("Waiting for approval:");
    for (const p of pending)
      out.push(
        `- ${p.kind === RATIFY_KIND ? `Adopting ${p.memo}` : p.kind === RECURRING_BUY_KIND ? `${capitalize(p.memo)}, at most ${usd(p.amountUsd)} in all` : `${usd(p.amountUsd)}${p.memo ? ` · ${p.memo}` : ""}`} — ${counts.get(p.id) ?? 0} of ${p.requiredApprovals} verified approvals`
      );
  }
  if (!t.adoptedAt) out.push("Our Treasury Rules were never adopted, so I move no money yet.");
  const note = unadoptedNote(t);
  if (note) out.push(note);
  const link = rulesLink(t);
  if (link) out.push(link);
  return out.join("\n");
}

/** The other rules that also bar this request, in one clause — the share rule said as a share.
 *  A rule that would have let the agent act alone is left out: citing it next to a refusal reads as a contradiction. */
function alsoClause(applied: TreasuryRule[], main: TreasuryRule | null, amountUsd: number, balanceUsd: number): string | null {
  const bits: string[] = [];
  for (const r of applied) {
    if (r === main || (main && r.text === main.text)) continue;
    if (!r.forbidden && r.approvals === 0) continue;
    const pct = sharePct(amountUsd, balanceUsd);
    if (r.minSharePct != null && pct != null) {
      const bar = r.forbidden
        ? `the rules don't allow moving more than ${r.minSharePct}% at once`
        : `the rules require ${membersWord(r.approvals)} to move more than ${r.minSharePct}% at once`;
      bits.push(`${usd(amountUsd)} is also ${pct}% of our ${usd(balanceUsd)} — ${bar}`);
      continue;
    }
    bits.push(`it also falls under “${r.text.replace(/\.$/, "")}”`);
  }
  return bits.length ? `${capitalize(bits.join("; "))}.` : null;
}

async function refuse(
  ctx: TreasuryCommandContext,
  t: RelationTreasury,
  cmd: MoneyCommand,
  recipient: Recipient | null,
  asker: Member,
  decision: { rule: TreasuryRule | null; reason: string; applied: TreasuryRule[] },
  balanceUsd: number
): Promise<string> {
  const ruleText = decision.rule?.text ?? decision.reason;
  // the refusal stands even if the record fails — nothing moves either way
  try {
    await createTreasuryAction({
      roomId: ctx.roomId,
      agentUserId: ctx.agentUserId,
      requestedBy: ctx.askerId,
      kind: cmd.kind,
      amountUsd: cmd.amountUsd,
      memo: cmd.memo || recipient?.label || "",
      recipientAddress: recipient?.address ?? null,
      recipientUserId: recipient?.userId ?? null,
      ruleText,
      requiredApprovals: 0,
      status: "blocked",
    });
  } catch (e) {
    console.error("[treasury] could not record a blocked action:", e);
  }
  const where = cmd.toSelf
    ? `to ${asker.displayName}'s own wallet`
    : recipient
      ? `to ${recipient.label}${memoNote(cmd.memo, recipient.label)}`
      : cmd.memo
        ? `for ${cmd.memo}`
        : "";
  await appendTreasuryActivity(ctx.roomId, [
    `⛔ Refused: ${usd(cmd.amountUsd)}${where ? ` ${where}` : ""} — ${decision.rule ? `“${ruleText}”` : sentence(ruleText)}`,
  ]).catch((e: unknown) => console.error("[treasury] could not log a blocked action:", e));

  // one thought per line — the chat bubble keeps line breaks
  const out = ["I won't do that."];
  out.push(decision.rule ? `Our treasury rules say: “${decision.rule.text}”` : sentence(decision.reason));
  const also = alsoClause(decision.applied, decision.rule, cmd.amountUsd, balanceUsd);
  if (also) out.push(also);
  const purpose = purposeClause(t);
  if (purpose) out.push(purpose);
  const note = unadoptedNote(t);
  if (note) out.push(note);
  const link = rulesLink(t);
  if (link) out.push(link);
  return out.join("\n");
}

/** Why there is nowhere to send it — nothing is created. */
function noRecipient(cmd: MoneyCommand, recipient: Recipient | null, payees: Payee[]): string {
  if (cmd.toSelf) return "You don't have a wallet address on file, so there's nowhere to send it — nothing was moved.";
  if (recipient) return `${recipient.label.replace(/'s wallet$/, "")} has no wallet address on file — nothing was moved.`;
  if (cmd.kind === "investment") return "We haven't agreed where idle funds go — add a payee to our memory first.";
  if (!payees.length)
    return "We haven't agreed on any payees yet — add one to the Payees section of our memory first. Nothing was moved.";
  const names = payees.map((p) => p.name);
  return (
    `I can only pay payees we agreed on, and I can't tell which one this is. Our memory lists: ${names.join(", ")}. ` +
    `Say which one (e.g. “pay ${names[0]} ${usd(cmd.amountUsd)}”), or add the payee to our memory first. Nothing was moved.`
  );
}

async function moneyReply(
  ctx: TreasuryCommandContext,
  t: RelationTreasury,
  cmd: MoneyCommand,
  balanceUsd: number,
  members: Member[],
  asker: Member
): Promise<string> {
  const recipient = resolveRecipient(cmd, asker, members, t.payees);
  // a withdrawal nobody could be matched for is still money to a person
  const personal = recipient ? recipient.personal : cmd.kind === "withdrawal";

  // evaluated before the recipient is required, so a forbidden request is
  // refused on the rule — never on a missing address
  const decision = evaluateCommand({
    policy: t.policy,
    kind: cmd.kind,
    amountUsd: cmd.amountUsd,
    personal,
    balanceUsd,
  });
  if (decision.outcome === "forbidden") return refuse(ctx, t, cmd, recipient, asker, decision, balanceUsd);
  if (decision.outcome === "insufficient")
    return `That's more than the treasury holds — we have ${usd(decision.balanceUsd)}. Nothing was moved.`;
  if (!recipient?.address) return noRecipient(cmd, recipient, t.payees);

  // the same payment already went out and its receipt was never seen: asking
  // again is how a hotel gets paid twice
  const [inFlight] = await db
    .select({ txHash: treasuryActions.txHash })
    .from(treasuryActions)
    .where(
      and(
        eq(treasuryActions.roomId, ctx.roomId),
        eq(treasuryActions.status, "unconfirmed"),
        eq(treasuryActions.recipientAddress, recipient.address),
        eq(treasuryActions.amountUsd, cmd.amountUsd)
      )
    )
    .limit(1);
  if (inFlight)
    return `I already sent ${destination(cmd.amountUsd, recipient, cmd.memo)} and am waiting for Sepolia to confirm it (tx ${inFlight.txHash}). I won't send it again until that settles — check the treasury panel. Nothing was moved.`;

  const base = {
    roomId: ctx.roomId,
    agentUserId: ctx.agentUserId,
    requestedBy: ctx.askerId,
    kind: cmd.kind,
    amountUsd: cmd.amountUsd,
    memo: cmd.memo || recipient.label,
    recipientAddress: recipient.address,
    recipientUserId: recipient.userId,
  };
  const what = destination(cmd.amountUsd, recipient, cmd.memo);

  if (decision.outcome === "auto") {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(treasuryActions)
      .where(
        and(
          eq(treasuryActions.roomId, ctx.roomId),
          eq(treasuryActions.requiredApprovals, 0),
          ne(treasuryActions.status, "blocked"),
          ne(treasuryActions.kind, RATIFY_KIND),
          // a recurring buy's weekly runs were approved as one authority — they are not payments made alone
          ne(treasuryActions.kind, RECURRING_BUY_KIND),
          ne(treasuryActions.kind, RECURRING_RUN_KIND),
          gt(treasuryActions.createdAt, new Date(Date.now() - 3_600_000))
        )
      );
    if (Number(recent?.n ?? 0) >= AUTO_PER_HOUR)
      return `I've already paid ${AUTO_PER_HOUR} expenses on my own in the last hour — that's as many as I make without anyone looking. Try again later. Nothing was moved.`;

    const action = await createTreasuryAction({ ...base, ruleText: decision.rule.text, requiredApprovals: 0 });
    let run: Awaited<ReturnType<typeof executeIfQuorum>>;
    try {
      run = await executeIfQuorum(action.id);
    } catch (e) {
      // it may have thrown after the transfer — say only what is known
      console.error("[treasury] auto execution threw:", e);
      return `I started paying ${what} on my own, but couldn't confirm the transfer (${(e as Error).message}). Check the treasury panel before asking again.`;
    }
    if (run.executed)
      return `✅ Paid ${what} on my own.\nOur rules allow it: “${decision.rule.text}”${run.txHash ? ` · tx ${run.txHash}` : ""}`;
    if (run.unconfirmedTx)
      return `I sent ${what} on my own (“${decision.rule.text}”), but couldn't confirm it yet (tx ${run.unconfirmedTx}) — it may still land. It's marked unconfirmed in the treasury panel; please don't ask for it again until it settles.`;
    return (
      `Our rules let me pay ${what} on my own (“${decision.rule.text}”), but the transfer didn't go through` +
      `${run.error ? `: ${sentence(run.error)}` : "."} It's marked in the treasury panel — check it before asking again.`
    );
  }

  // approval — seats are read first so a failure there leaves nothing half-queued
  const seated = await seatedUserIds(ctx.roomId);
  await createTreasuryAction({
    ...base,
    ruleText: decision.rule.text,
    requiredApprovals: decision.required,
    status: "pending",
  });
  // the request stands even if the ledger line fails — the action row is the record
  await appendTreasuryActivity(ctx.roomId, [
    `📝 ${asker.displayName} asked: ${usd(cmd.amountUsd)} · ${base.memo} — ${toApprove(decision.required)}`,
  ]).catch((e: unknown) => console.error("[treasury] could not log a queued action:", e));
  const pct = sharePct(cmd.amountUsd, balanceUsd);
  // what, why, what to do — one line each. How duplicates are caught is left
  // for the moment it happens (the voided notice), not announced up front.
  const out = [
    `⏳ Queued: ${what}${decision.rule.minSharePct != null && pct != null ? ` — ${pct}% of our ${usd(balanceUsd)}` : ""}.`,
    `Needs ${humans(decision.required)} — our rules: “${decision.rule.text}”`,
    `Approve with World ID in the treasury panel above.`,
  ];
  out.push(...seatShortfall(t, members, seated, decision.required));
  const note = unadoptedNote(t);
  if (note) out.push(note);
  return out.join("\n");
}

/** "Only 2 of us have a vote so far — Alex, Bea: claim yours…" when the voters can't reach the bar yet. */
function seatShortfall(t: RelationTreasury, members: Member[], seated: Set<string>, required: number): string[] {
  const voting = members.filter((m) => t.electorate.includes(m.userId));
  const seatedCount = voting.filter((m) => seated.has(m.userId)).length;
  if (seatedCount >= required) return [];
  const unseated = voting.filter((m) => !seated.has(m.userId)).map((m) => m.displayName);
  const lead = seatedCount === 0 ? "Nobody has a vote yet" : `Only ${seatedCount} of us ${seatedCount === 1 ? "has" : "have"} a vote so far`;
  return unseated.length ? [`${lead} — ${unseated.join(", ")}: claim yours with World ID in the treasury panel first.`] : [];
}

/**
 * "@agent adopt the new rules": puts the doc's current Rules and Payees — and
 * the room's current members — to a vote. Changing what the agent follows is
 * the most sensitive thing a relation can do with its treasury, so it takes
 * the strictest bar any rule names (old or new), and never fewer than 2.
 */
async function adoptReply(ctx: TreasuryCommandContext, t: RelationTreasury, members: Member[], asker: Member): Promise<string> {
  const p = t.proposal;
  if (!p)
    return "Our Treasury Rules and Payees are exactly what we adopted, and everyone here already votes — there's nothing to adopt.";
  if (p.policy.unparsed.length)
    return `I can't read ${p.policy.unparsed.length === 1 ? "this line" : "these lines"} in our Treasury Rules: ${p.policy.unparsed.map((l) => `“${l}”`).join("; ")}. Fix ${p.policy.unparsed.length === 1 ? "it" : "them"} before we adopt anything — nothing changed.`;

  const [waiting] = await db
    .select({ id: treasuryActions.id, ruleText: treasuryActions.ruleText })
    .from(treasuryActions)
    .where(
      and(
        eq(treasuryActions.roomId, ctx.roomId),
        eq(treasuryActions.kind, RATIFY_KIND),
        eq(treasuryActions.status, "pending"),
        gt(treasuryActions.createdAt, new Date(Date.now() - REQUEST_TTL_MS))
      )
    )
    .orderBy(desc(treasuryActions.createdAt))
    .limit(1);
  const proposed = JSON.stringify([p.text.rules, p.text.payees, p.text.members]);
  if (waiting) {
    let same = false;
    try {
      const w = JSON.parse(waiting.ruleText) as RatifiedText;
      same = JSON.stringify([w.rules, w.payees, w.members]) === proposed;
    } catch {
      // unreadable: treat as a different change
    }
    if (same) return "That change is already waiting for approval — members with a vote can approve it in the treasury panel.";
  }

  const bars = [...t.policy.rules, ...p.policy.rules].filter((r) => !r.forbidden).map((r) => r.approvals);
  const required = Math.max(2, ...bars);
  const bar = `Changing what the agent follows takes our strictest bar: ${membersWord(required)} approve.`;
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "a new member";
  const joined = p.joined.map(nameOf);
  const text: RatifiedText = { ...p.text, added: p.added, removed: p.removed, joined, bar };
  const parts = [
    p.added.length || p.removed.length || p.reordered ? "our edited Treasury Rules and Payees" : null,
    joined.length ? `${joined.join(", ")} as voting member${joined.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const memo = parts.join(" and ") || "our Treasury Rules and Payees";

  const seated = await seatedUserIds(ctx.roomId);
  await createTreasuryAction({
    roomId: ctx.roomId,
    agentUserId: ctx.agentUserId,
    requestedBy: ctx.askerId,
    kind: RATIFY_KIND,
    amountUsd: 0,
    memo,
    ruleText: JSON.stringify(text),
    requiredApprovals: required,
    status: "pending",
  });
  const changes = [
    ...p.added.map((l) => `+ “${l}”`),
    ...p.removed.map((l) => `− “${l}”`),
    ...(p.reordered ? ["the order of the lines"] : []),
    ...joined.map((n) => `+ ${n} votes`),
  ];
  await appendTreasuryActivity(ctx.roomId, [
    `📝 ${asker.displayName} asked: adopt ${memo} — ${toApprove(required)}${changes.length ? ` (${changes.join("; ")})` : ""}`,
  ]).catch((e: unknown) => console.error("[treasury] could not log a ratification request:", e));

  const out = [
    `⏳ Queued: adopting ${memo}.`,
    changes.length ? `Changes: ${changes.join("; ")}.` : "",
    `Needs ${humans(required)} — ${bar.charAt(0).toLowerCase()}${bar.slice(1)}`,
    "Until then I keep following the version we adopted.",
    "Approve with World ID in the treasury panel above.",
    ...seatShortfall(t, members, seated, required),
  ];
  return out.filter(Boolean).join("\n");
}

// ── recurring buy ───────────────────────────────────────────────────────────

type RecurringCommand = Extract<TreasuryCommand, { kind: `recurring-${string}` }>;

function isRecurring(cmd: TreasuryCommand): cmd is RecurringCommand {
  return cmd.kind.startsWith("recurring-");
}

const RECURRING_EXAMPLE = "“@agent buy $20 of ETH every week for 26 weeks”";

function weeksWord(n: number): string {
  return `${n} week${n === 1 ? "" : "s"}`;
}

async function recurringProposeReply(
  ctx: TreasuryCommandContext,
  t: RelationTreasury,
  cmd: Extract<RecurringCommand, { kind: "recurring-propose" }>,
  members: Member[]
): Promise<string> {
  // seats first, so a failure there leaves nothing half-queued
  const seated = await seatedUserIds(ctx.roomId);
  const r = await proposeRecurringBuy({
    roomId: ctx.roomId,
    agentUserId: ctx.agentUserId,
    requesterId: ctx.askerId,
    weeklyUsd: cmd.weeklyUsd,
    weeks: cmd.weeks,
  });
  if (!r.ok) return r.reason;
  const out = [...queuedLines({ record: r.record, required: r.required, rule: r.rule }), ...seatShortfall(t, members, seated, r.required)];
  // the room chat draws the marker line as the request's live card, Approve button included
  return `${out.join("\n")}\n${recurringBuyMarker(r.actionId)}`;
}

async function recurringRunReply(ctx: TreasuryCommandContext): Promise<string> {
  const r = await runRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  switch (r.outcome) {
    case "bought":
      return boughtLine(r);
    case "skipped":
      if (r.reason === "already-bought-this-week") return "Already bought this week.";
      // a failed swap may have sent a transaction: recurring.ts logged it, and it holds the week
      if (r.reason === "swap-failed")
        return "⚠️ This week's swap didn't go through. If a transaction went out, Treasury Activity has it — check before asking again.";
      return `Skipped this week: ${SKIP_REASON_TEXT[r.reason]}.`;
    case "rehearsal":
      return `Rehearsal: would buy ${usd(r.wouldBuyUsd)} of ETH this week — nothing moved.`;
    case "none":
      return `No recurring buy is running.\nTry ${RECURRING_EXAMPLE}.`;
  }
}

async function recurringStopReply(ctx: TreasuryCommandContext): Promise<string> {
  // read before, only to say which of the two a stop did
  const before = await recurringBuyStatus(ctx.roomId).catch(() => null);
  const r = await stopRecurringBuy({ roomId: ctx.roomId, byUserId: ctx.askerId });
  if (!r.ok) return r.reason;
  if (r.actionId === before?.pending?.actionId) return "✖ Withdrew the recurring buy request.";
  return "⏹ Stopped the recurring buy.";
}

async function recurringStatusReply(roomId: string): Promise<string> {
  const s = await recurringBuyStatus(roomId);
  const out: string[] = [];
  if (s.live) {
    const l = s.live;
    const week = l.thisWeek === "bought" ? "bought this week" : l.thisWeek === "skipped" ? "skipped this week" : "not bought this week yet";
    out.push(
      `🔁 Recurring buy: ${usd(l.weeklyUsd)} of ETH weekly · week ${l.weekIndex} of ${l.weeks} · ${week}.`,
      `Bought ${l.boughtWeeks} of ${weeksWord(l.weeks)} (${usd(l.investedUsd)} → ${wethShort(l.wethOut)} WETH)${l.nextRunAt ? ` · next buy ${relationDay(l.nextRunAt)}` : ""}.`
    );
  }
  if (s.pending) {
    const p = s.pending;
    out.push(
      `⏳ Waiting for approval: ${usd(p.weeklyUsd)} of ETH weekly for ${weeksWord(p.weeks)}, up to ${usd(p.exposureUsd)}.`,
      `${p.approvals} of ${p.required} verified humans so far — our rules: “${p.rule}”`
    );
  }
  if (!out.length) return `No recurring buy is running.\nTry ${RECURRING_EXAMPLE}.`;
  return out.join("\n");
}

/** Stop and status: any current human member. Proposing and running direct the treasury: the adopted electorate. */
async function recurringReply(
  ctx: TreasuryCommandContext,
  t: RelationTreasury,
  cmd: RecurringCommand,
  members: Member[],
  asker: Member
): Promise<string> {
  if (cmd.kind === "recurring-status") return recurringStatusReply(ctx.roomId);
  if (cmd.kind === "recurring-stop") return recurringStopReply(ctx);
  if (!t.adoptedAt)
    return "Our Treasury Rules were never adopted, so I move no money yet. “@agent adopt the rules” puts them to a vote — nothing was moved.";
  if (!t.electorate.includes(asker.userId))
    return "You joined after our rules were adopted, so you can't direct the treasury yet. “@agent adopt the new members” puts that to a vote — nothing was moved.";
  return cmd.kind === "recurring-propose" ? recurringProposeReply(ctx, t, cmd, members) : recurringRunReply(ctx);
}

/**
 * Answer a treasury command, or return null so the caller carries on with its
 * normal path: null when the text is not about moving money, or when the
 * room's memory has no Treasury Rules (the treasury is off there). A money
 * sentence the matcher could not read gets a fixed "nothing was moved" — it
 * never reaches the model, which could otherwise answer as if it had paid.
 */
export async function handleTreasuryCommand(ctx: TreasuryCommandContext): Promise<{ text: string } | null> {
  const cmd = matchTreasuryCommand(ctx.text, ctx.agentName);
  // "buy ETH every week", in English or Korean: not one payment, and not for the model to answer either
  const repeated = !cmd && mentionsRecurringMoney(ctx.text, ctx.agentName);
  if (!cmd && !repeated && !mentionsMoney(ctx.text, ctx.agentName)) return null;
  const treasury = await loadRelationTreasury(ctx.roomId);
  if (!treasury) return null;
  // a message can also arrive over A2A under a member token; only a current
  // human member of the room directs its money
  const members = await roomHumans(ctx.roomId);
  const asker = members.find((m) => m.userId === ctx.askerId);
  if (!asker) return { text: "Only members of this room can use its treasury — nothing was moved." };

  if (!cmd && repeated)
    return {
      text: `I didn't move anything — I don't make a payment again and again from one message. A repeated buy is a recurring buy the members approve once: say ${RECURRING_EXAMPLE}.`,
    };
  if (!cmd) {
    const example = treasury.payees[0]?.name ?? "the hotel";
    return {
      text: `I didn't move anything. I act only on a plain request with one dollar amount — like “@agent pay ${example} $180”.`,
    };
  }
  if (cmd.kind === "adopt") {
    try {
      return { text: await adoptReply(ctx, treasury, members, asker) };
    } catch (e) {
      console.error("[treasury] adopt failed:", e);
      return { text: `Something went wrong on my side (${(e as Error).message}) — nothing changed.` };
    }
  }

  if (isRecurring(cmd)) {
    try {
      return { text: await recurringReply(ctx, treasury, cmd, members, asker) };
    } catch (e) {
      // never the error's text: a chain error can carry the RPC URL
      if (e instanceof RecurringBuyRefusal) return { text: e.message };
      console.error(`[treasury] ${cmd.kind} failed:`, logLine(e));
      return {
        text:
          cmd.kind === "recurring-run"
            ? "Something went wrong on my side while running the recurring buy — check its history in the treasury panel before asking again."
            : "Something went wrong on my side — nothing was moved.",
      };
    }
  }

  let balance: { wei: bigint; eth: string; usd: number };
  try {
    const { address } = await ensureAgentWallet(ctx.agentUserId);
    balance = await treasuryBalance(address);
  } catch (e) {
    console.error("[treasury] balance read failed:", e);
    return { text: "I can't read the treasury balance right now — nothing was moved." };
  }

  if (cmd.kind === "status") return { text: await statusReply(treasury, ctx.roomId, balance) };
  if (!treasury.adoptedAt)
    return {
      text: "Our Treasury Rules were never adopted, so I move no money yet. “@agent adopt the rules” puts them to a vote — nothing was moved.",
    };
  if (!treasury.electorate.includes(asker.userId))
    return {
      text: "You joined after our rules were adopted, so you can't direct the treasury yet. “@agent adopt the new members” puts that to a vote — nothing was moved.",
    };
  try {
    return { text: await moneyReply(ctx, treasury, cmd, balance.usd, members, asker) };
  } catch (e) {
    // executeIfQuorum's failures are caught inside, so anything landing here
    // happened before a transfer was attempted
    console.error("[treasury] command failed:", e);
    return { text: `Something went wrong on my side (${(e as Error).message}) — nothing was moved.` };
  }
}
