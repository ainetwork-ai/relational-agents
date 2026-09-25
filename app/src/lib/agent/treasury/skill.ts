import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, treasuryActions, treasuryApprovals, treasurySeats, users } from "@/lib/db/schema";
import { matchTreasuryCommand } from "./match";
import { evaluateCommand } from "./policy";
import { appendTreasuryActivity, loadRelationTreasury } from "./memory";
import { ensureAgentWallet, treasuryBalance, USD_PER_ETH } from "./wallet";
import { createTreasuryAction, executeIfQuorum } from "./approvals";
import type { Payee, RelationTreasury, TreasuryCommand, TreasuryKind, TreasuryRule } from "./types";

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
  return t.rulesPageId ? `(Rules → /p/${t.rulesPageId})` : null;
}

function sharePct(amountUsd: number, balanceUsd: number): number | null {
  return balanceUsd > 0 ? Math.round((amountUsd / balanceUsd) * 100) : null;
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

/** The agreed payee the memo names — most shared words wins, ties go to the doc's order. */
function payeeNamed(memo: string, payees: Payee[]): Payee | null {
  const said = tokens(memo);
  let best: Payee | null = null;
  let bestScore = 0;
  for (const p of payees) {
    let score = 0;
    for (const w of tokens(p.name)) if (said.has(w)) score++;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// "invest $300 of the idle funds" names no payee; a payee the relation
// labelled as where savings go is the only place idle funds may be sent.
const INVESTMENT_PAYEE = /\b(invest\w*|vault|pool|savings?|staking|yield|aave|lido|compound)\b/i;

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
    .orderBy(asc(chatRoomMembers.joinedAt));
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
      amountUsd: treasuryActions.amountUsd,
      memo: treasuryActions.memo,
      requiredApprovals: treasuryActions.requiredApprovals,
    })
    .from(treasuryActions)
    .where(and(eq(treasuryActions.roomId, roomId), eq(treasuryActions.status, "pending")))
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
        `- ${usd(p.amountUsd)}${p.memo ? ` · ${p.memo}` : ""} — ${counts.get(p.id) ?? 0} of ${p.requiredApprovals} verified approvals`
      );
  }
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
      bits.push(`${usd(amountUsd)} would also be ${pct}% of our ${usd(balanceUsd)} — ${bar}`);
      continue;
    }
    bits.push(`it would also fall under “${r.text.replace(/\.$/, "")}”`);
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
    ? "to their own wallet"
    : recipient
      ? `to ${recipient.label}${memoNote(cmd.memo, recipient.label)}`
      : cmd.memo
        ? `for ${cmd.memo}`
        : "";
  await appendTreasuryActivity(ctx.roomId, [
    `⛔ Blocked: ${asker.displayName} asked me to send ${usd(cmd.amountUsd)}${where ? ` ${where}` : ""}. Rule: “${ruleText}”`,
  ]).catch((e: unknown) => console.error("[treasury] could not log a blocked action:", e));

  const out = ["I won't do that."];
  out.push(decision.rule ? `Our treasury rules say: “${decision.rule.text}”` : sentence(decision.reason));
  const also = alsoClause(decision.applied, decision.rule, cmd.amountUsd, balanceUsd);
  if (also) out.push(also);
  const purpose = purposeClause(t);
  if (purpose) out.push(purpose);
  const link = rulesLink(t);
  if (link) out.push(link);
  return out.join(" ");
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
      return `✅ Paid ${what} on my own — our rules allow it: “${decision.rule.text}”${run.txHash ? ` (tx ${run.txHash})` : ""}`;
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
  const pct = sharePct(cmd.amountUsd, balanceUsd);
  const out = [
    `Queued: ${what}${decision.rule.minSharePct != null && pct != null ? ` — ${pct}% of our ${usd(balanceUsd)}` : ""}.`,
    `This needs ${humans(decision.required)}. Our rules say: “${decision.rule.text}”`,
    `Seated members: tap “Approve with World ID” in the treasury panel — each approval is a fresh World ID check, and one human counts once no matter how many accounts they have.`,
  ];
  const seatedCount = members.filter((m) => seated.has(m.userId)).length;
  if (seatedCount < decision.required) {
    const unseated = members.filter((m) => !seated.has(m.userId)).map((m) => m.displayName);
    const lead = seatedCount === 0 ? "Nobody holds a seat yet" : `Only ${seatedCount} of us ${seatedCount === 1 ? "holds" : "hold"} a seat so far`;
    if (unseated.length) out.push(`${lead} — ${unseated.join(", ")}: claim yours with World ID in the treasury panel first.`);
  }
  return out.join(" ");
}

/**
 * Answer a treasury command, or return null so the caller carries on with its
 * normal path: null when the text is not a money sentence, or when the room's
 * memory has no Treasury Rules (the treasury is off there).
 */
export async function handleTreasuryCommand(ctx: TreasuryCommandContext): Promise<{ text: string } | null> {
  const cmd = matchTreasuryCommand(ctx.text, ctx.agentName);
  if (!cmd) return null;
  const treasury = await loadRelationTreasury(ctx.roomId);
  if (!treasury) return null;
  // a message can also arrive over A2A under a member token; only a current
  // human member of the room directs its money
  const members = await roomHumans(ctx.roomId);
  const asker = members.find((m) => m.userId === ctx.askerId);
  if (!asker) return { text: "Only members of this room can use its treasury — nothing was moved." };

  let balance: { wei: bigint; eth: string; usd: number };
  try {
    const { address } = await ensureAgentWallet(ctx.agentUserId);
    balance = await treasuryBalance(address);
  } catch (e) {
    console.error("[treasury] balance read failed:", e);
    return { text: "I can't read the treasury balance right now — nothing was moved." };
  }

  if (cmd.kind === "status") return { text: await statusReply(treasury, ctx.roomId, balance) };
  try {
    return { text: await moneyReply(ctx, treasury, cmd, balance.usd, members, asker) };
  } catch (e) {
    // executeIfQuorum's failures are caught inside, so anything landing here
    // happened before a transfer was attempted
    console.error("[treasury] command failed:", e);
    return { text: `Something went wrong on my side (${(e as Error).message}) — nothing was moved.` };
  }
}
