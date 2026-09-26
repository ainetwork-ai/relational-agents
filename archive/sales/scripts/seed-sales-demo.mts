/**
 * The sales demo's workspace: "Nurisoft Sales Team", where three salespeople's
 * phones meet.
 *
 *   pnpm demo:sales [--home ~/.ainmem-demo] [--reset]
 *
 * Run scripts/sales-demo-accounts.mts first — it makes the three people
 * (aindrive accounts + one drive per phone + ainmem accounts) and writes
 * <home>/sales.json. This script then, as those people:
 *   1. makes the team lead's workspace with the two others as members, and an
 *      "Sales Team 1" teamspace for the three of them;
 *   2. links each phone's drive into the teamspace (the lead's first, so the
 *      teamspace's OKF backup lands in his drive);
 *   3. writes the team's home page — each phone's latest calls, linked from
 *      aindrive, not copied — and how the stages are judged;
 *   4. opens the team chat with its agent (business profile);
 *   5. points the demo login ("Start with demo account", DEMO_LOGIN_ADDRESS) at the lead.
 *
 * The pipeline itself is NOT seeded: the demo is asking the agent for it —
 * "@agent build a unified sales pipeline" in the team chat.
 *
 * --reset removes the workspace this script made before (and its pages, chat,
 * links) and builds it again. Without it, a second run changes nothing.
 */

// env first — @/lib/db opens its pool at import time
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { and, eq, inArray } = await import("drizzle-orm");
const { db } = await import("../src/lib/db");
const S = await import("../src/lib/db/schema");
type BlockType = import("../src/lib/db/schema").BlockType;
type BlockContent = import("../src/lib/db/schema").BlockContent;
const { listDrives, listTree } = await import("../src/lib/aindrive");
const { runAs } = await import("../src/lib/aindrive-account");
const { aindriveFileUrl } = await import("../src/lib/aindrive-url");
const { provisionRoomAgent } = await import("../src/lib/agent/provision");
const { runBackup } = await import("../src/lib/aindrive-backup");
const { deleteNode } = await import("../src/lib/okf-store");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const RESET = process.argv.includes("--reset");
const WORKSPACE = "Nurisoft Sales Team";
const TEAMSPACE = "Sales Team 1";

type Key = "kim" | "lee" | "park";
const KEYS: Key[] = ["park", "lee", "kim"]; // the lead first
const ROLE: Record<Key, string> = { park: "Team Lead", lee: "Manager", kim: "Assistant Manager" };
const team = JSON.parse(fs.readFileSync(path.join(HOME, "sales.json"), "utf8")) as {
  aindrive: string;
  members: Record<Key, { name: string; drive: string; ainmemUserId: string }>;
};
const base = (process.env.AINDRIVE_PUBLIC_URL || process.env.AINDRIVE_SERVER || team.aindrive).replace(/\/+$/, "");
const M = team.members;
const ids = Object.fromEntries(KEYS.map((k) => [k, M[k].ainmemUserId])) as Record<Key, string>;

// ── each phone's drive, and its calls ───────────────────────────────────────

const drive = {} as Record<Key, { id: string; files: string[] }>;
for (const k of KEYS) {
  drive[k] = await runAs(ids[k], async () => {
    const d = (await listDrives()).find((x) => x.name === M[k].drive);
    if (!d) throw new Error(`${M[k].name}: no drive named "${M[k].drive}" — is its aindrive CLI running?`);
    return { id: d.id, files: await listTree({ driveId: d.id, root: "" }, 500) };
  });
  console.log(`${M[k].name}: drive ${drive[k].id}, ${drive[k].files.length} files`);
}
const calls = (k: Key) => drive[k].files.filter((f) => f.startsWith("call-records/") && f.endsWith(".md")).sort();

// ── reset ────────────────────────────────────────────────────────────────────

const [existing] = await db.select().from(S.workspaces).where(eq(S.workspaces.name, WORKSPACE));
if (existing && !RESET) {
  console.log(`"${WORKSPACE}" already exists (${existing.id}) — rerun with --reset to rebuild it`);
  process.exit(0);
}
if (existing) {
  const rooms = await db.select({ id: S.chatRooms.id }).from(S.chatRooms).where(eq(S.chatRooms.workspaceId, existing.id));
  if (rooms.length) {
    const roomIds = rooms.map((r) => r.id);
    // the team agent's working record lives as OKF files, outside the workspace
    // cascade — without this every reset leaves one more in the sidebar
    const states = await db.select().from(S.agentRoomStates).where(inArray(S.agentRoomStates.roomId, roomIds));
    for (const st of states) if (st.rootOkfPath) deleteNode(st.rootOkfPath);
    await db.delete(S.agentRoomStates).where(inArray(S.agentRoomStates.roomId, roomIds));
    await db.delete(S.okfAcl).where(inArray(S.okfAcl.roomId, roomIds));
    await db.delete(S.chatMessages).where(inArray(S.chatMessages.roomId, roomIds));
    await db.delete(S.chatRoomMembers).where(inArray(S.chatRoomMembers.roomId, roomIds));
    await db.delete(S.chatRoomBots).where(inArray(S.chatRoomBots.roomId, roomIds));
    await db.delete(S.chatRooms).where(inArray(S.chatRooms.id, roomIds));
  }
  await db.delete(S.workspaces).where(eq(S.workspaces.id, existing.id)); // pages, teamspaces, links cascade
  console.log(`removed the previous "${WORKSPACE}"`);
}

// ── workspace, members, teamspace ──────────────────────────────────────────

const [ws] = await db
  .insert(S.workspaces)
  .values({ name: WORKSPACE, iconText: "📈", description: "Where the three sales team members' phone call histories come together via aindrive", createdBy: ids.park })
  .returning();
// Signing in made each of them a personal workspace first, and with no
// workspace picked the app lands on the oldest one a person owns (then the
// oldest membership) — so this membership is dated before theirs, and the
// lead, who owns it, lands on the team's workspace (the demo login is him).
const firstJoined = await db
  .select({ at: S.workspaceMembers.joinedAt })
  .from(S.workspaceMembers)
  .where(inArray(S.workspaceMembers.userId, KEYS.map((k) => ids[k])))
  .orderBy(S.workspaceMembers.joinedAt)
  .limit(1);
const joinedAt = new Date((firstJoined[0]?.at ?? new Date()).getTime() - 60_000);
await db
  .insert(S.workspaceMembers)
  .values(KEYS.map((k) => ({ workspaceId: ws.id, userId: ids[k], role: k === "park" ? "owner" : "member", joinedAt })));
const [ts] = await db
  .insert(S.teamspaces)
  .values({ workspaceId: ws.id, name: TEAMSPACE, icon: "📞", description: "Each person's phone call history → one sales pipeline", createdBy: ids.park })
  .returning();
await db.insert(S.teamspaceMembers).values(KEYS.map((k) => ({ teamspaceId: ts.id, userId: ids[k], role: k === "park" ? "owner" : "member" })));
// each phone is linked by its owner; the lead's first, so the OKF backup goes there
for (const k of KEYS)
  await db.insert(S.teamspaceDrives).values({
    teamspaceId: ts.id,
    name: M[k].drive,
    driveId: drive[k].id,
    root: "",
    createdBy: ids[k],
    backup: k === "park",
  });

// ── pages ────────────────────────────────────────────────────────────────────

type B = { type: BlockType; content: BlockContent };
const h2 = (text: string): B => ({ type: "heading2", content: { text } });
const p = (text: string): B => ({ type: "paragraph", content: { text } });
const bullet = (text: string): B => ({ type: "bulleted_list", content: { text } });
const callout = (icon: string, text: string): B => ({ type: "callout", content: { text, icon } });
const file = (k: Key, rel: string): B => ({
  type: "file",
  content: { url: aindriveFileUrl(base, { driveId: drive[k].id, path: rel }), text: rel.split("/").pop() },
});

let pagePos = 0;
async function page(title: string, icon: string, body: B[], by: Key = "park") {
  const [pg] = await db
    .insert(S.pages)
    .values({ workspaceId: ws.id, teamspaceId: ts.id, title, icon, position: ++pagePos, createdBy: ids[by] })
    .returning();
  if (body.length)
    await db.insert(S.blocks).values(body.map((b, i) => ({ pageId: pg.id, type: b.type, content: b.content, position: i + 1 })));
  return pg;
}

const stages = await page("Sales Stage Criteria", "🧭", [
  p("The pipeline stage is decided by the call content. If several people have called the same account, the most recent call is the one that counts."),
  bullet("Lead — first call, confirming interest only"),
  bullet("Needs assessment — discussing required features/budget, scheduling a demo or visit"),
  bullet("Proposal — proposal or quote sent or explained"),
  bullet("Negotiation — adjusting price or contract terms"),
  bullet("Contract closed — contract signed or finalized"),
  bullet("On hold — postponed or fell through"),
]);

const home = await page("Sales Team 1 Home", "📞", [
  callout(
    "📱",
    "Every time a call ends, the three phones upload the call history (summary + transcript) to each person's aindrive as markdown. " +
      "Those three aindrive folders are connected to this teamspace — the files stay on each person's aindrive, and here we just view them as links."
  ),
  callout("✨", "Say \"@agent build a unified sales pipeline\" in the team chat, and the agent reads all three phones' call histories and builds a pipeline page broken down by account."),
  ...KEYS.flatMap((k) => [
    h2(`${M[k].name}, ${ROLE[k]} — ${M[k].drive}`),
    p(`${calls(k).length} calls · recent calls`),
    ...calls(k).slice(-3).reverse().map((f) => file(k, f)),
  ]),
  h2("Reference"),
  { type: "link_to_page", content: { childPageId: stages.id } },
]);
await db.update(S.pages).set({ position: 0 }).where(eq(S.pages.id, home.id));

// ── the team chat and its agent ─────────────────────────────────────────────

const [room] = await db
  .insert(S.chatRooms)
  .values({ name: TEAMSPACE, kind: "dm", workspaceId: ws.id, createdBy: ids.park, consentAt: new Date() })
  .returning();
await db.insert(S.chatRoomMembers).values(KEYS.map((k) => ({ roomId: room.id, userId: ids[k] })));
const agent = await provisionRoomAgent(room, KEYS.map((k) => ids[k]), ids.park);
await db
  .update(S.users)
  .set({ agentConfig: { profile: "business", skills: ["relationship-doc", "sales-pipeline"] } })
  .where(eq(S.users.id, agent.agentUserId));
const talk: [Key, string][] = [
  ["kim", "How did the Daehan Trading deal go after I handed it off to you? My phone only has calls up through the 9th."],
  ["lee", "Got the signed contract for Seojin Foods this morning! 20 stores, 48 million won 🎉"],
  ["park", "Great work, everyone. Accounts are scattered all over this week, let's look at them all at once."],
];
let t = Date.now() - talk.length * 60_000;
for (const [k, text] of talk)
  await db.insert(S.chatMessages).values({ roomId: room.id, authorId: ids[k], text, createdAt: new Date((t += 60_000)) });

// ── names, and the demo login lands on the lead ─────────────────────────────

for (const k of KEYS) await db.update(S.users).set({ displayName: M[k].name }).where(eq(S.users.id, ids[k]));
const demo = (process.env.DEMO_LOGIN_ADDRESS ?? "").toLowerCase();
if (/^0x[0-9a-f]{40}$/.test(demo)) {
  // the address may sit on an older demo account — move it to the lead
  await db.update(S.users).set({ ainAddress: null }).where(and(eq(S.users.ainAddress, demo)));
  await db.update(S.users).set({ ainAddress: demo }).where(eq(S.users.id, ids.park));
  console.log(`demo login → ${M.park.name}`);
}

// the teamspace's first OKF sync into the lead's drive, now rather than on the first edit
const synced = await runBackup(ts.id);
console.log(`OKF sync → 「${M.park.drive}」: ${synced.files} files${synced.error ? ` (error: ${synced.error})` : ""}`);

console.log(`\n"${WORKSPACE}" ready: workspace ${ws.id}, teamspace ${ts.id}, team chat ${room.id}`);
console.log(`demo: in the team chat, "@agent build a unified sales pipeline"`);
process.exit(0);
