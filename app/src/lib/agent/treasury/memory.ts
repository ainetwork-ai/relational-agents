import "server-only";
import path from "node:path";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRoomStates, chatRoomMembers, treasuryActions, users } from "@/lib/db/schema";
import { readNode, nodeExists } from "@/lib/okf-store";
import { appendOkfLines, okfDocPageId, type NewLine } from "@/lib/agent/okf-docs";
import { parsePayees, parseTreasuryPolicy } from "./policy";
import {
  RATIFY_KIND,
  TREASURY_TIME_ZONE,
  type RatifiedText,
  type RelationTreasury,
  type TreasuryProposal,
} from "./types";

/**
 * The treasury's view of the relation's memory doc. Its sections are
 * registered in agentRoomStates.sectionOkfPaths by the seed — never as profile
 * sections, which the recording LLM appends to — and found by title in the doc
 * folder when the map lost them (a pipeline run that started before a key was
 * added writes back the map it read).
 *
 * The doc is where the rules are written, not what is enforced: every member
 * can edit it (and delete and recreate a page by title), so the agent follows
 * the text the relation last ADOPTED — a ratify action in the database — and
 * reports anything the doc says beyond it as a proposal.
 */

const SECTIONS = {
  "treasury-rules": "Treasury Rules",
  purpose: "Purpose",
  payees: "Payees",
  "treasury-activity": "Treasury Activity",
} as const;
type SectionKey = keyof typeof SECTIONS;

type RoomState = { rootOkfPath: string | null; sectionOkfPaths: Record<string, string> };

async function roomState(roomId: string): Promise<RoomState | null> {
  const [state] = await db
    .select({ rootOkfPath: agentRoomStates.rootOkfPath, sectionOkfPaths: agentRoomStates.sectionOkfPaths })
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  return state ?? null;
}

/** where a section lives, and whether the map already says so */
function resolveSection(state: RoomState, key: SectionKey): { rel: string; registered: boolean } | null {
  const saved = state.sectionOkfPaths?.[key];
  if (saved && nodeExists(saved)) return { rel: saved, registered: true };
  const root = state.rootOkfPath;
  if (!root || !nodeExists(root)) return null;
  const folder = readNode(root);
  if (!folder || folder.kind !== "page") return null;
  const want = SECTIONS[key].toLowerCase();
  for (const child of folder.children) {
    if (child.kind !== "page" || !/\.md$/i.test(child.id)) continue;
    if (child.name.trim().toLowerCase() === want) return { rel: child.id, registered: false };
    const node = readNode(child.id);
    if (node?.kind === "page" && node.title.trim().toLowerCase() === want) return { rel: child.id, registered: false };
  }
  return null;
}

/** One line per text-bearing block (a block's own line breaks split too).
 *  Every block counts, not just bullets: text in the rules section that isn't
 *  a rule must surface as unparsed rather than be skipped unseen. */
function sectionLines(rel: string): string[] {
  const node = readNode(rel);
  if (!node || node.kind !== "page") return [];
  return node.blocks.flatMap((b) => {
    if (b.type === "image") return [];
    const text = ((b.content ?? {}) as { text?: unknown }).text;
    return typeof text === "string" ? text.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  });
}

async function register(roomId: string, key: SectionKey, rel: string): Promise<void> {
  // jsonb merge in SQL: other keys (profile sections, the seed's) stay untouched
  await db
    .update(agentRoomStates)
    .set({
      sectionOkfPaths: sql`${agentRoomStates.sectionOkfPaths} || ${JSON.stringify({ [key]: rel })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(agentRoomStates.roomId, roomId));
}

/** a rule or payee line as adopted and compared: no bullet, single spaces */
function normLine(line: string): string {
  return line.replace(/^[-*•]\s+/, "").replace(/\s+/g, " ").trim();
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}

function liveText(state: RoomState): { rules: string[]; payees: string[]; rulesRel: string } | null {
  const rules = resolveSection(state, "treasury-rules");
  if (!rules) return null;
  const payees = resolveSection(state, "payees");
  return {
    rules: sectionLines(rules.rel).map(normLine).filter(Boolean),
    payees: payees ? sectionLines(payees.rel).map(normLine).filter(Boolean) : [],
    rulesRel: rules.rel,
  };
}

/** The Rules and Payees text the doc holds right now; null = no Treasury Rules section (treasury off). */
export async function liveTreasuryText(roomId: string): Promise<{ rules: string[]; payees: string[] } | null> {
  const state = await roomState(roomId);
  const live = state ? liveText(state) : null;
  return live && { rules: live.rules, payees: live.payees };
}

/** The room's human members, oldest first (ties by userId, so the order is stable) — who an adoption made now would let vote. */
export async function humanMemberIds(roomId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(users.isAgent, false)))
    .orderBy(asc(chatRoomMembers.joinedAt), asc(chatRoomMembers.userId));
  return rows.map((r) => r.userId);
}

/** Reads a ratify row's rule_text; null when it isn't one (an unreadable adoption adopts nothing). */
export function parseRatified(json: string): RatifiedText | null {
  try {
    const v = JSON.parse(json) as Partial<RatifiedText>;
    const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
    if (!strings(v.rules) || !strings(v.payees) || !strings(v.members)) return null;
    return {
      rules: v.rules,
      payees: v.payees,
      members: v.members,
      added: strings(v.added) ? v.added : [],
      removed: strings(v.removed) ? v.removed : [],
      joined: strings(v.joined) ? v.joined : [],
      bar: typeof v.bar === "string" ? v.bar : undefined,
    };
  } catch {
    return null;
  }
}

/** The version in force: the latest adoption to be decided (claim time, not request time). */
export async function latestAdoption(roomId: string): Promise<{ id: string; at: Date; text: RatifiedText } | null> {
  const [row] = await db
    .select({ id: treasuryActions.id, ruleText: treasuryActions.ruleText, decidedAt: treasuryActions.decidedAt })
    .from(treasuryActions)
    .where(
      and(eq(treasuryActions.roomId, roomId), eq(treasuryActions.kind, RATIFY_KIND), eq(treasuryActions.status, "executed"))
    )
    .orderBy(desc(treasuryActions.decidedAt), desc(treasuryActions.createdAt))
    .limit(1);
  if (!row) return null;
  const text = parseRatified(row.ruleText);
  return text && row.decidedAt ? { id: row.id, at: row.decidedAt, text } : null;
}

/** Lines in `next` but not in `prev` (as a multiset, so a duplicated line counts). */
function linesAdded(prev: string[], next: string[]): string[] {
  const left = [...prev];
  return next.filter((l) => {
    const i = left.indexOf(l);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

export async function loadRelationTreasury(roomId: string): Promise<RelationTreasury | null> {
  const state = await roomState(roomId);
  if (!state) return null;
  const live = liveText(state);
  if (!live) return null;
  const purpose = resolveSection(state, "purpose");
  const activity = resolveSection(state, "treasury-activity");
  const [adopted, members] = await Promise.all([latestAdoption(roomId), humanMemberIds(roomId)]);

  // never adopted: the doc is shown, and the agent moves no money until it is
  const enforced = adopted?.text ?? { rules: live.rules, payees: live.payees, members };
  const textChanged = !adopted || !sameLines(adopted.text.rules, live.rules) || !sameLines(adopted.text.payees, live.payees);
  const joined = adopted ? members.filter((id) => !adopted.text.members.includes(id)) : [];
  let proposal: TreasuryProposal | null = null;
  if (textChanged || joined.length) {
    const prev = adopted ? [...adopted.text.rules, ...adopted.text.payees] : [];
    const next = [...live.rules, ...live.payees];
    const added = linesAdded(prev, next);
    const removed = linesAdded(next, prev);
    proposal = {
      text: { rules: live.rules, payees: live.payees, members },
      policy: parseTreasuryPolicy(live.rules.join("\n")),
      payees: parsePayees(live.payees.join("\n")),
      added,
      removed,
      reordered: textChanged && !added.length && !removed.length,
      joined,
    };
  }

  return {
    roomId,
    policy: parseTreasuryPolicy(enforced.rules.join("\n")),
    payees: parsePayees(enforced.payees.join("\n")),
    purpose: purpose ? sectionLines(purpose.rel).join("\n") : "",
    rulesPageId: okfDocPageId(live.rulesRel),
    activityPath: activity?.rel ?? null,
    adoptedAt: adopted ? adopted.at.toISOString() : null,
    electorate: adopted ? adopted.text.members : members,
    proposal,
  };
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TREASURY_TIME_ZONE,
  weekday: "long",
  month: "short",
  day: "numeric",
});

/**
 * "Friday, Sep 25" — the Treasury Activity's date heading, on the relation's
 * calendar. It is also the dedupe key: appendOkfLines skips the heading when
 * the file's last h1 already says it, so the seed writes its first heading
 * with this same function.
 */
export function activityDayHeading(d: Date): string {
  return dayFormat.format(d);
}

export async function appendTreasuryActivity(roomId: string, lines: string[]): Promise<void> {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return;
  const state = await roomState(roomId);
  if (!state?.rootOkfPath || !nodeExists(state.rootOkfPath)) return;

  const found = resolveSection(state, "treasury-activity");
  const rel = found?.rel ?? path.posix.join(state.rootOkfPath, `${SECTIONS["treasury-activity"]}.md`);
  const blocks: NewLine[] = [
    { type: "heading1", text: activityDayHeading(new Date()) },
    ...clean.map((text) => ({ type: "bulleted_list" as const, text })),
  ];
  // appendOkfLines drops the heading when the file's last h1 is already today
  appendOkfLines(rel, SECTIONS["treasury-activity"], blocks, { type: "Memory", relationId: roomId, roomId });
  if (!found?.registered) await register(roomId, "treasury-activity", rel);
}
