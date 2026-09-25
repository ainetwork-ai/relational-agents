import "server-only";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRoomStates } from "@/lib/db/schema";
import { readNode, nodeExists } from "@/lib/okf-store";
import { appendOkfLines, okfDocPageId, type NewLine } from "@/lib/agent/okf-docs";
import { parsePayees, parseTreasuryPolicy } from "./policy";
import type { RelationTreasury } from "./types";

/**
 * The treasury's view of the relation's memory doc. Its sections are
 * registered in agentRoomStates.sectionOkfPaths by the seed — never as profile
 * sections, which the recording LLM appends to — and found by title in the doc
 * folder when the map lost them (a pipeline run that started before a key was
 * added writes back the map it read).
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

export async function loadRelationTreasury(roomId: string): Promise<RelationTreasury | null> {
  const state = await roomState(roomId);
  if (!state) return null;
  const rules = resolveSection(state, "treasury-rules");
  if (!rules) return null;
  const purpose = resolveSection(state, "purpose");
  const payees = resolveSection(state, "payees");
  const activity = resolveSection(state, "treasury-activity");
  return {
    roomId,
    policy: parseTreasuryPolicy(sectionLines(rules.rel).join("\n")),
    payees: payees ? parsePayees(sectionLines(payees.rel).join("\n")) : [],
    purpose: purpose ? sectionLines(purpose.rel).join("\n") : "",
    rulesPageId: okfDocPageId(rules.rel),
    activityPath: activity?.rel ?? null,
  };
}

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function appendTreasuryActivity(roomId: string, lines: string[]): Promise<void> {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return;
  const state = await roomState(roomId);
  if (!state?.rootOkfPath || !nodeExists(state.rootOkfPath)) return;

  const found = resolveSection(state, "treasury-activity");
  const rel = found?.rel ?? path.posix.join(state.rootOkfPath, `${SECTIONS["treasury-activity"]}.md`);
  const blocks: NewLine[] = [
    { type: "heading1", text: isoDay(new Date()) },
    ...clean.map((text) => ({ type: "bulleted_list" as const, text })),
  ];
  // appendOkfLines drops the heading when the file's last h1 is already today
  appendOkfLines(rel, SECTIONS["treasury-activity"], blocks, { type: "Memory", relationId: roomId, roomId });
  if (!found?.registered) await register(roomId, "treasury-activity", rel);
}
