/**
 * The Relation Treasury demo: five friends pooling money for ETHGlobal Tokyo,
 * and a room agent that holds the pot under rules they wrote themselves.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts [--try] [--reset] [--no-fund] [--no-preseat] [--app URL]
 *     --try      the try-it copy that /world opens to visitors: the same room,
 *                rules and faces under its own accounts (try-alex …), its own
 *                workspace, agent and wallet, and nobody seated — so what
 *                visitors do never touches the recording room
 *     --reset    delete the "Tokyo Trip" room(s) Alex made (treasury rows, chat,
 *                agent, relation doc) and the six accounts' notifications, and
 *                build it again; accounts are kept
 *     --no-fund  skip the Sepolia top-up of the treasury
 *     --no-preseat  seat nobody: with the Portal app configured, every seat on
 *                camera should be a real IDKit proof, not a seeded one
 *     --join-alex2  invite "Alex (2nd account)" into the room after the
 *                adoption — what scene 2 does on camera, for a take that
 *                starts after it
 *     --app      base URL printed in the links (default http://localhost:36625)
 *     --mine 0x…  a presenter's own copy: the same room, rules and faces, its own
 *                workspace ("… (demo)"), Alex's account is the presenter's wallet
 *                (MetaMask login lands on it), Chris, Dana and Eli seated, and a
 *                recurring buy already adopted with their seeded approvals. Its agent
 *                holds DEMO_POT_KEY (app/.env.demo) and its rows take fixed ids, so
 *                every server this runs on shows the same pot and names the same
 *                contributions (scripts/demo-contributions.mts starts those on Base).
 *                --name sets Alex's name on a new account; an existing account keeps its own,
 *                and its World ID and notifications: the copy adds rows and changes only
 *                what it made (--reset removes only the fixed room).
 *
 * Makes, idempotently:
 *   - six accounts reachable by demo login (POST /api/auth/demo-login
 *     { as: "tokyo-alex" } …): Alex, Bea, Chris, Dana, Eli, and
 *     "Alex (2nd account)" — the same human as Alex on a second account, the
 *     case one-human-one-seat exists for — each with a face from
 *     public/demo/tokyo/ (the room's agent too);
 *   - the "ETHGlobal Tokyo Team" workspace (Alex owns it, all six are members);
 *   - the "Tokyo Trip" room of the five friends with its agent, and the chat
 *     where they agreed on the rules. The 2nd account is not in the room: on
 *     camera Alex invites it after the rules are adopted (Invite people) and it
 *     asks for a vote with Alex's own World ID. --join-alex2 does that invite
 *     here; --try keeps it in the room from the start, so /world visitors can
 *     pick it;
 *   - the relation doc's treasury sections (Purpose, Treasury Rules, Payees,
 *     Treasury Activity) — what lib/agent/treasury/memory.ts reads — and its
 *     own sections (Overview, Meeting log, Agreements, Action items, Contacts,
 *     Open questions) filed from the chat, as lib/tokyo-trip-record.ts words them;
 *   - the founding adoption of those Rules and Payees (the chat above is where
 *     they were agreed) — what the agent enforces until the relation adopts
 *     an edit with the strictest quorum;
 *   - seats for Chris, Dana and Eli (Alex and Bea claim theirs live);
 *   - the agent's Sepolia wallet, topped up to $1,000 at the demo scale.
 *
 * Every run also unbinds the demo accounts' World IDs (users.world_sub): a
 * rehearsal against the mock IdP binds them to "mock-human-N", and a binding
 * kept into the recording voids that member's first real approval as "bound
 * to a different World ID".
 *
 * A second run without --reset adds only what is missing: doc pages already on
 * disk are left alone (the demo appends activity), and an existing adoption is
 * kept.
 */

// env first — @/lib/db opens its pool at import time, wallet.ts reads its RPC
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);
try {
  process.loadEnvFile?.(new URL("../.env.demo", import.meta.url).pathname);
} catch {
  // only --mine needs it
}

const path = await import("node:path");
const { randomUUID } = await import("node:crypto");
const { and, eq, inArray, isNull } = await import("drizzle-orm");
const { keccak256, stringToBytes } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");
const { db } = await import("../src/lib/db");
const S = await import("../src/lib/db/schema");
type ChatRoom = import("../src/lib/db/schema").ChatRoom;
type ParsedBlock = import("../src/lib/memory-parse").ParsedBlock;
const { provisionRoomAgent } = await import("../src/lib/agent/provision");
const { profileForRoom } = await import("../src/lib/agent/profiles");
const { ensureOkfDocTree, okfDocMeta, okfDocPageId, appendOkfLines, docRootTitle } = await import(
  "../src/lib/agent/okf-docs"
);
const { deleteNode, nodeExists, readNode, writePage } = await import("../src/lib/okf-store");
const { tokyoTripRecord, TREASURY_OPENING } = await import("../src/lib/tokyo-trip-record");
const { setOkfAcl } = await import("../src/lib/okf-acl");
const { ensureGeneralTeamspace } = await import("../src/lib/workspace");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const TRY = process.argv.includes("--try");
/** the presenter's wallet — Alex's account in their own copy */
const MINE = arg("mine")?.toLowerCase();
if (MINE !== undefined && !/^0x[0-9a-f]{40}$/.test(MINE)) throw new Error("--mine takes the presenter's wallet address (0x…)");
if (MINE && TRY) throw new Error("--mine and --try are separate copies — pick one");
const MINE_NAME = arg("name");
const DEMO_POT_KEY = process.env.DEMO_POT_KEY?.trim();
if (MINE && !/^0x[0-9a-fA-F]{64}$/.test(DEMO_POT_KEY ?? "")) throw new Error("--mine needs DEMO_POT_KEY in app/.env.demo — the one pot every server shows");
// fixed ids, so the presenter's copy is the same on every server (contribution salts name members by id)
const { stableId, MINE_ROOM_ID: FIXED_ROOM_ID } = await import("./demo-ids.mts");
const RESET = process.argv.includes("--reset");
const FUND = !process.argv.includes("--no-fund");
const PRESEAT = !TRY && !process.argv.includes("--no-preseat");
const JOIN_ALEX2 = !TRY && process.argv.includes("--join-alex2");
const APP = (arg("app", "http://localhost:36625") as string).replace(/\/+$/, "");
const WORKSPACE = TRY ? "ETHGlobal Tokyo Team (try it)" : MINE ? "ETHGlobal Tokyo Team (demo)" : "ETHGlobal Tokyo Team";
const ROOM = "Tokyo Trip";
const TREASURY_USD = 1000;
// src/lib/world-demo.ts finds each copy by its Alex: `demo:${PREFIX}-alex`
const PREFIX = TRY ? "try" : MINE ? "mine" : "tokyo";
/** the presenter's copy: one room id on every server and for every presenter — the friends' contribution salts depend on it */
const MINE_ROOM_ID = MINE ? FIXED_ROOM_ID : null;

type Key = "alex" | "bea" | "chris" | "dana" | "eli" | "alex2";
const PEOPLE: { key: Key; slug: string; name: string }[] = [
  { key: "alex", slug: `${PREFIX}-alex`, name: "Alex" },
  { key: "bea", slug: `${PREFIX}-bea`, name: "Bea" },
  { key: "chris", slug: `${PREFIX}-chris`, name: "Chris" },
  { key: "dana", slug: `${PREFIX}-dana`, name: "Dana" },
  { key: "eli", slug: `${PREFIX}-eli`, name: "Eli" },
  { key: "alex2", slug: `${PREFIX}-alex2`, name: "Alex (2nd account)" },
];
/** in the room from the start — the 2nd account joins later (Alex's invite on camera, or --join-alex2), except in the try-it copy, where visitors pick it */
const IN_ROOM = PEOPLE.filter((p) => TRY || p.key !== "alex2");
/** seated by the seed; Alex and Bea claim theirs on stage, Alex's 2nd account never gets one */
const PRESEATED: Key[] = ["chris", "dana", "eli"];

// The payee is the funder itself: on testnet a "hotel payment" recycles to the
// account that seeded the treasury, so rehearsals do not drain it.
const funderKey = (process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY ?? "").trim();
if (!funderKey) throw new Error("set RELAYER_KEY or DEPLOYER_KEY in app/.env.local — the payee and the funding both come from it");
const funder = privateKeyToAccount((funderKey.startsWith("0x") ? funderKey : `0x${funderKey}`) as `0x${string}`).address;
// Savings is an address of its own, so an investment visibly leaves the pot
// (a Sepolia transfer beside the Base swap). Derived from the funder's key, so
// it is the same on every run and the funder can always sweep it back.
const savings = privateKeyToAccount(keccak256(stringToBytes(`${funderKey}:tokyo-trip savings`))).address;

// ── accounts ────────────────────────────────────────────────────────────────
// demo-login `as` finds an account by ainAddress "demo:<slug>" and keeps its
// display name, so these are the same rows a browser lands on.

// faces: public/demo/tokyo/<key>.jpg (512px squares); the agent's is agent.jpg
const avatarOf = (key: Key | "agent") => `/demo/tokyo/${key}.jpg`;

const ids = {} as Record<Key, string>;
for (const p of PEOPLE) {
  // in the presenter's copy Alex is their wallet: MetaMask login (metamask-verify) finds the account by it
  const wallet = MINE && p.key === "alex" ? MINE : null;
  const ainAddress = wallet ?? `demo:${p.slug}`;
  const name = wallet ? (MINE_NAME ?? p.name) : p.name;
  const avatarUrl = avatarOf(p.key);
  const [found] = await db.select().from(S.users).where(eq(S.users.ainAddress, ainAddress)).limit(1);
  if (found) {
    // a presenter's existing account keeps its own name and face unless --name asks
    if (!wallet && (found.displayName !== name || found.avatarUrl !== avatarUrl))
      await db.update(S.users).set({ displayName: name, avatarUrl }).where(eq(S.users.id, found.id));
    if (wallet && MINE_NAME && found.displayName !== MINE_NAME) await db.update(S.users).set({ displayName: MINE_NAME }).where(eq(S.users.id, found.id));
    ids[p.key] = found.id;
  } else {
    const [created] = await db
      .insert(S.users)
      // Alex's id follows the wallet (two presenters are two accounts); the friends' ids are the same everywhere
      .values({ ...(MINE ? { id: stableId(`${PREFIX}:${wallet ? `alex:${wallet}` : p.key}`) } : {}), ainAddress, displayName: name, avatarUrl })
      .returning();
    ids[p.key] = created.id;
  }
}
const humanIds = PEOPLE.map((p) => ids[p.key]);
const roomHumanIds = IN_ROOM.map((p) => ids[p.key]);
/** the accounts this copy owns: in the presenter's copy Alex is their own wallet account, which the seed never changes */
const ownIds = MINE ? humanIds.filter((id) => id !== ids.alex) : humanIds;
await db
  .update(S.users)
  .set({ worldSub: null, worldVerifiedAt: null })
  .where(inArray(S.users.id, ownIds));

// ── reset ───────────────────────────────────────────────────────────────────

/** the agent's wallet key survives a reset, so the treasury's SepETH is not stranded with a deleted agent */
let carriedKey: string | null = null;
if (RESET) {
  // rehearsal pings ("Treasury: approve $150 …") would sit in every bell; the
  // first one on camera should be the new request's
  const cleared = await db
    .delete(S.notifications)
    .where(inArray(S.notifications.userId, ownIds))
    .returning({ id: S.notifications.id });
  if (cleared.length) console.log(`cleared ${cleared.length} notification(s) of the demo accounts`);

  // the presenter's copy removes only its own fixed room — never another room the presenter's account made
  const rooms = await db
    .select({ id: S.chatRooms.id })
    .from(S.chatRooms)
    .where(MINE_ROOM_ID ? eq(S.chatRooms.id, MINE_ROOM_ID) : and(eq(S.chatRooms.name, ROOM), eq(S.chatRooms.createdBy, ids.alex)));
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length) {
    const actions = await db
      .select({ id: S.treasuryActions.id })
      .from(S.treasuryActions)
      .where(inArray(S.treasuryActions.roomId, roomIds));
    if (actions.length)
      await db.delete(S.treasuryApprovals).where(inArray(S.treasuryApprovals.actionId, actions.map((a) => a.id)));
    await db.delete(S.treasuryActions).where(inArray(S.treasuryActions.roomId, roomIds));
    await db.delete(S.treasurySeats).where(inArray(S.treasurySeats.roomId, roomIds));
    await db.delete(S.personhoodProofs).where(inArray(S.personhoodProofs.roomId, roomIds));
    await db.delete(S.callUtterances).where(inArray(S.callUtterances.roomId, roomIds));
    await db.delete(S.chatMessages).where(inArray(S.chatMessages.roomId, roomIds));

    const bots = await db.select().from(S.chatRoomBots).where(inArray(S.chatRoomBots.roomId, roomIds));
    const agentIds = bots.map((b) => b.agentUserId);
    if (agentIds.length) {
      const agents = await db
        .select({ id: S.users.id, key: S.users.encryptedPrivateKey })
        .from(S.users)
        .where(and(inArray(S.users.id, agentIds), eq(S.users.isAgent, true)));
      carriedKey = agents.find((a) => a.key)?.key ?? null;
      await db.delete(S.agentAccessTokens).where(inArray(S.agentAccessTokens.agentUserId, agentIds));
      await db.delete(S.users).where(and(inArray(S.users.id, agentIds), eq(S.users.isAgent, true)));
    }
    await db.delete(S.chatRoomBots).where(inArray(S.chatRoomBots.roomId, roomIds));
    await db.delete(S.chatRoomMembers).where(inArray(S.chatRoomMembers.roomId, roomIds));

    // the relation doc is OKF files, outside any cascade
    const states = await db.select().from(S.agentRoomStates).where(inArray(S.agentRoomStates.roomId, roomIds));
    for (const st of states) {
      if (!st.rootOkfPath) continue;
      deleteNode(st.rootOkfPath);
      await db.delete(S.okfAcl).where(eq(S.okfAcl.path, st.rootOkfPath));
    }
    await db.delete(S.agentRoomStates).where(inArray(S.agentRoomStates.roomId, roomIds));
    await db.delete(S.okfAcl).where(inArray(S.okfAcl.roomId, roomIds));
    await db.delete(S.chatRooms).where(inArray(S.chatRooms.id, roomIds));
    console.log(`removed ${roomIds.length} previous "${ROOM}" room(s)${carriedKey ? " — keeping the agent's wallet key" : ""}`);
  }
}

// ── workspace ───────────────────────────────────────────────────────────────

let [ws] = await db.select().from(S.workspaces).where(eq(S.workspaces.name, WORKSPACE)).limit(1);
if (!ws)
  [ws] = await db
    .insert(S.workspaces)
    .values({ name: WORKSPACE, iconText: "🗼", description: "Five friends going to ETHGlobal Tokyo, Sep 25–27", createdBy: ids.alex })
    .returning();
// No personal workspaces: with none picked, the app lands on a person's owned
// workspace first, then their oldest membership, and lists only that
// workspace's rooms — so the team workspace must be everyone's landing. Dated
// before any membership they already had, like seed-family-demo.
const [firstJoined] = await db
  .select({ at: S.workspaceMembers.joinedAt })
  .from(S.workspaceMembers)
  .where(inArray(S.workspaceMembers.userId, humanIds))
  .orderBy(S.workspaceMembers.joinedAt)
  .limit(1);
const joinedAt = new Date((firstJoined?.at ?? new Date()).getTime() - 60_000);
await db
  .insert(S.workspaceMembers)
  .values(PEOPLE.map((p) => ({ workspaceId: ws.id, userId: ids[p.key], role: p.key === "alex" ? "owner" : "member", joinedAt })))
  .onConflictDoNothing();
const teamspaceId = await ensureGeneralTeamspace(ws.id, ids.alex);
await db
  .insert(S.teamspaceMembers)
  .values(PEOPLE.map((p) => ({ teamspaceId, userId: ids[p.key], role: p.key === "alex" ? "owner" : "member" })))
  .onConflictDoNothing();
// demo-login's ensureWorkspace seeds "Getting Started" into a member's
// workspace when it has no page — one page of our own keeps it out
const [anyPage] = await db
  .select({ id: S.pages.id })
  .from(S.pages)
  .where(and(eq(S.pages.workspaceId, ws.id), eq(S.pages.isArchived, false)))
  .limit(1);
if (!anyPage) {
  const [pg] = await db
    .insert(S.pages)
    .values({ workspaceId: ws.id, teamspaceId, title: "ETHGlobal Tokyo", icon: "🗼", position: 1, createdBy: ids.alex })
    .returning();
  await db.insert(S.blocks).values([
    { pageId: pg.id, type: "callout", content: { icon: "🧳", text: "Sep 25–27 · Alex, Bea, Chris, Dana and Eli · Hotel Gracery Shinjuku" }, position: 1 },
    {
      pageId: pg.id,
      type: "paragraph",
      content: { text: "Our trip pot is held by the Tokyo Trip agent. What it may do with it is written in the rules we agreed on in the Tokyo Trip chat." },
      position: 2,
    },
  ]);
}

// ── the room and its agent ──────────────────────────────────────────────────

const talk: [Key, string][] = [
  ["alex", "ETHGlobal Tokyo is locked in — Sep 25 to 27! Let's each put $200 into a trip pot."],
  ["bea", "In. Hotel comes first though — Gracery Shinjuku still has rooms near the venue."],
  ["chris", "Small stuff like snacks or a taxi, the agent can just pay. Anything under $50?"],
  ["dana", "Bigger stuff needs a couple of us. $50 to $200, two of us say yes. Over $200, three."],
  ["eli", "Same three if we ever invest the idle funds. And moving more than 30% of the pot at once needs four."],
  ["bea", "Also nobody takes the pot home — no sending it to anyone's personal wallet."],
  ["alex", "Deal. That's our rules, written into the trip doc."],
  ["eli", "Sent my $200 — that's all five of us, $1,000 in the pot 🙌"],
];
const lastAt = Date.now() - 3 * 60_000;
const firstAt = lastAt - (talk.length - 1) * 60_000;

let [room]: (ChatRoom | undefined)[] = await db
  .select()
  .from(S.chatRooms)
  .where(
    MINE_ROOM_ID
      ? eq(S.chatRooms.id, MINE_ROOM_ID)
      : and(eq(S.chatRooms.name, ROOM), eq(S.chatRooms.createdBy, ids.alex), eq(S.chatRooms.kind, "dm"))
  )
  .orderBy(S.chatRooms.createdAt)
  .limit(1);
if (room && MINE && room.createdBy !== ids.alex)
  throw new Error(`the demo room belongs to another presenter's account — rerun with --reset to hand it to ${MINE}`);
if (!room)
  [room] = await db
    .insert(S.chatRooms)
    .values({
      ...(MINE_ROOM_ID ? { id: MINE_ROOM_ID } : {}),
      name: ROOM,
      kind: "dm",
      workspaceId: ws.id,
      createdBy: ids.alex,
      // signed before they talked: the rules come from a conversation the
      // agent was allowed to hear (pre-consent messages are never collected)
      consentAt: new Date(firstAt - 60_000),
      createdAt: new Date(firstAt - 120_000),
    })
    .returning();
if (!room) throw new Error("could not create the room");
const roomId = room.id;
// Joined in IN_ROOM order, a second apart: member lists sort by joinedAt, and a
// single insert would give them all the same instant — the order was then the
// uuids', different on every reset. Just before now, so the chat above (dated
// minutes ago) does not count as unread.
const joinedFrom = Date.now() - (IN_ROOM.length + 1) * 1000;
await db
  .insert(S.chatRoomMembers)
  .values(roomHumanIds.map((userId, i) => ({ roomId, userId, joinedAt: new Date(joinedFrom + i * 1000) })))
  .onConflictDoNothing();
const { agentUserId } = await provisionRoomAgent(room, roomHumanIds, ids.alex);
// A room seeded before that (or rerun) keeps its rows, so the order is set
// again against the agent's join, which never moves: the members a second
// apart, ending just before it — the same values on every run.
{
  const [agentMember] = await db
    .select({ at: S.chatRoomMembers.joinedAt })
    .from(S.chatRoomMembers)
    .where(and(eq(S.chatRoomMembers.roomId, roomId), eq(S.chatRoomMembers.userId, agentUserId)));
  const anchor = (agentMember?.at ?? new Date()).getTime();
  for (const [i, p] of IN_ROOM.entries())
    await db
      .update(S.chatRoomMembers)
      .set({ joinedAt: new Date(anchor - (IN_ROOM.length - i) * 1000) })
      .where(and(eq(S.chatRoomMembers.roomId, roomId), eq(S.chatRoomMembers.userId, ids[p.key])));
}
// five friends running a trip fund read as a team, not a family: the business
// profile titles the doc "Working record" with Agreements / Action items /
// Meeting log, where the default family profile brings Health & care
{
  const [agentRow] = await db.select({ agentConfig: S.users.agentConfig }).from(S.users).where(eq(S.users.id, agentUserId));
  await db
    .update(S.users)
    .set({
      agentConfig: { ...((agentRow?.agentConfig ?? {}) as Record<string, unknown>), profile: "business" },
      avatarUrl: avatarOf("agent"),
    })
    .where(eq(S.users.id, agentUserId));
}
if (carriedKey)
  await db
    .update(S.users)
    .set({ encryptedPrivateKey: carriedKey })
    .where(and(eq(S.users.id, agentUserId), isNull(S.users.encryptedPrivateKey)));
// the presenter's copy: the same pot on every server — ensureAgentWallet seals the plain key in place
if (MINE)
  await db
    .update(S.users)
    .set({ encryptedPrivateKey: DEMO_POT_KEY })
    .where(and(eq(S.users.id, agentUserId), isNull(S.users.encryptedPrivateKey)));

// the chat, once — a rerun must not repeat it
const [anyMessage] = await db
  .select({ id: S.chatMessages.id })
  .from(S.chatMessages)
  .where(eq(S.chatMessages.roomId, roomId))
  .limit(1);
if (!anyMessage) {
  // Already recorded — into the treasury sections below. Marked processed so
  // the pipeline does not file the same talk a second time into the profile
  // sections, and recorded so each line shows "Added to your record".
  const recordedAt = new Date();
  await db.insert(S.chatMessages).values(
    talk.map(([k, text], i) => ({
      roomId,
      authorId: ids[k],
      text,
      createdAt: new Date(firstAt + i * 60_000),
      processedAt: recordedAt,
      recordedAt,
    }))
  );
}

// ── the relation doc's treasury sections ────────────────────────────────────
// The savings payee is the agent's own wallet: investing idle funds is a
// Uniswap swap on Base signed by the agent (lib/agent/treasury/invest.ts), and
// the WETH stays with the agent. The wallet must exist before the doc names it.
const { ensureAgentWallet, fundTreasury, treasuryBalance } = await import("../src/lib/agent/treasury/wallet");
const { address: agentAddress } = await ensureAgentWallet(agentUserId);
if (MINE && agentAddress.toLowerCase() !== privateKeyToAccount(DEMO_POT_KEY as `0x${string}`).address.toLowerCase())
  throw new Error(`the agent already holds another key (${agentAddress}) — rerun with --reset to give it DEMO_POT_KEY`);

// Registered in sectionOkfPaths under their own keys, never as profile
// sections (the recording LLM appends to those; parseEdits accepts only
// profile keys). Bullets only: readOkfSectionTexts drops blocks without text,
// so a markdown table would vanish, and every line of the rules section is
// parsed — anything that is not a rule makes the policy fail closed.

const profile = await profileForRoom(roomId);
const [state0] = await db.select().from(S.agentRoomStates).where(eq(S.agentRoomStates.roomId, roomId));
const tree = ensureOkfDocTree(roomId, room.name, profile, {
  rootPath: state0?.rootOkfPath,
  sectionPaths: state0?.sectionOkfPaths,
});
// the same participant set the pipeline writes (members incl. the agent + creator)
const participants = [
  ...new Set([
    room.createdBy,
    ...(await db.select({ userId: S.chatRoomMembers.userId }).from(S.chatRoomMembers).where(eq(S.chatRoomMembers.roomId, roomId))).map(
      (m) => m.userId
    ),
  ]),
];
await setOkfAcl(tree.rootPath, roomId, participants);

// the heading appendTreasuryActivity writes ("Friday, Sep 25") — the same
// function, since it is also the key today's appends dedupe against
const { activityDayHeading } = await import("../src/lib/agent/treasury/memory");
const SECTIONS: { key: string; title: string; okfType: "Fact" | "Memory"; blocks: [ParsedBlock["type"], string][] }[] = [
  {
    key: "purpose",
    title: "Purpose",
    okfType: "Fact",
    blocks: [
      ["bulleted_list", "Fund our five-person trip to ETHGlobal Tokyo, Sep 25–27 — the hotel comes first."],
      ["bulleted_list", "We each put in $200; the pot is for the trip, not for anyone to take home."],
    ],
  },
  {
    key: "treasury-rules",
    title: "Treasury Rules",
    okfType: "Fact",
    blocks: [
      ["bulleted_list", "Shared expenses under $50: the agent may pay on its own."],
      ["bulleted_list", "Shared expenses from $50 to $200: 2 verified members approve."],
      ["bulleted_list", "Shared expenses over $200: 3 verified members approve."],
      ["bulleted_list", "Investing idle funds: 3 verified members approve."],
      ["bulleted_list", "Moving more than 30% of the treasury at once: 4 verified members approve."],
      ["bulleted_list", "Sending treasury money to a member's personal wallet: not allowed."],
    ],
  },
  {
    key: "payees",
    title: "Payees",
    okfType: "Fact",
    blocks: [
      ["bulleted_list", `Hotel Gracery Shinjuku: ${funder}`],
      ["bulleted_list", `Savings (idle funds): ${savings}`],
    ],
  },
  {
    key: "treasury-activity",
    title: "Treasury Activity",
    okfType: "Memory",
    // dated the way appendTreasuryActivity writes, so today's entries join this heading
    blocks: [
      ["heading1", activityDayHeading(new Date())],
      ["bulleted_list", TREASURY_OPENING],
    ],
  },
];

const sectionPaths: Record<string, string> = { ...tree.sectionPaths };
const written: string[] = [];
for (const s of SECTIONS) {
  const saved = state0?.sectionOkfPaths?.[s.key];
  const rel = saved && nodeExists(saved) ? saved : path.posix.join(tree.rootPath, `${s.title}.md`);
  sectionPaths[s.key] = rel;
  if (nodeExists(rel)) continue;
  writePage(
    rel,
    s.title,
    okfDocMeta(roomId, profile, undefined, { type: s.okfType }),
    s.blocks.map(([type, text], i) => ({ id: randomUUID(), type, content: { text }, position: i + 1 }))
  );
  written.push(s.title);
}

// The doc's own sections, as the agent would have filed the talk above had it
// not been marked recorded (lib/tokyo-trip-record.ts). Only into empty ones:
// a rerun must not write over what the pipeline has added since.
{
  const talkIds = (
    await db
      .select({ id: S.chatMessages.id })
      .from(S.chatMessages)
      .where(eq(S.chatMessages.roomId, roomId))
      .orderBy(S.chatMessages.createdAt)
      .limit(talk.length)
  ).map((m) => m.id);
  for (const s of tokyoTripRecord(roomId, talkIds, new Date(firstAt))) {
    const rel = sectionPaths[s.key];
    if (!rel) continue;
    const node = nodeExists(rel) ? readNode(rel) : null;
    const hasText =
      node?.kind === "page" && node.blocks.some((b) => (((b.content ?? {}) as { text?: string }).text ?? "").trim());
    if (hasText) continue;
    writePage(rel, s.title, okfDocMeta(roomId, profile, s.key), s.blocks);
    written.push(s.title);
  }
}

// the doc's index is its table of contents — a page nothing links to is one nobody finds
const index = readNode(tree.rootPath);
const indexTexts =
  index && index.kind === "page" ? index.blocks.map((b) => ((b.content ?? {}) as { text?: string }).text ?? "") : [];
const missing = SECTIONS.filter((s) => !indexTexts.some((t) => t.includes(`[${s.title}]`)));
if (missing.length)
  appendOkfLines(
    tree.rootPath,
    docRootTitle(room.name, profile),
    missing.map((s) => ({ type: "bulleted_list" as const, text: `[${s.title}](/p/${okfDocPageId(sectionPaths[s.key])})` }))
  );

await db
  .insert(S.agentRoomStates)
  .values({ roomId, rootOkfPath: tree.rootPath, sectionOkfPaths: sectionPaths, updatedAt: new Date() })
  .onConflictDoUpdate({
    target: S.agentRoomStates.roomId,
    set: { rootOkfPath: tree.rootPath, sectionOkfPaths: sectionPaths, updatedAt: new Date() },
  });

// ── the founding adoption ───────────────────────────────────────────────────
// The rules above are the ones the five agreed in the chat; the agent enforces
// the adopted text, not the doc, so an edit is only a proposal until the
// strictest quorum adopts it. Recorded once — a rerun keeps what was adopted.

const { adoptFoundingRules } = await import("../src/lib/agent/treasury/approvals");
const adoptedNow = await adoptFoundingRules({ roomId, agentUserId, requestedBy: ids.alex });

// ── the second account joins (scene 2) ──────────────────────────────────────
// After the adoption, as Alex's "Invite people" does it on camera: a member of
// the room but not of the electorate — no vote until the relation adopts its
// new membership, and no seat either, since its World ID is Alex's.
if (JOIN_ALEX2) {
  await db.insert(S.chatRoomMembers).values({ roomId, userId: ids.alex2 }).onConflictDoNothing();
  await setOkfAcl(tree.rootPath, roomId, [...participants, ids.alex2]);
}

// ── seats ───────────────────────────────────────────────────────────────────

// labelled "dev-simulator": the panel rings these red (not counted), never green as World ID
if (PRESEAT)
  await db
    .insert(S.treasurySeats)
    .values(
      PRESEATED.map((k) => ({
        roomId,
        userId: ids[k],
        nullifierHash: keccak256(stringToBytes(`seed:${ids[k]}:treasury-seat:${roomId}`)),
        verificationLevel: "dev-simulator",
      }))
    )
    .onConflictDoNothing();

// ── the treasury wallet ─────────────────────────────────────────────────────

const address = agentAddress;
let funding = "skipped (--no-fund)";
let failed = false;
if (FUND) {
  try {
    const tx = await fundTreasury(address, TREASURY_USD);
    funding = tx ? `funded to $${TREASURY_USD.toLocaleString("en-US")} — tx ${tx}` : `already holds $${TREASURY_USD.toLocaleString("en-US")} or more`;
  } catch (err) {
    failed = true;
    funding = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }
}
let balance = "unavailable";
try {
  const b = await treasuryBalance(address);
  balance = `$${b.usd.toLocaleString("en-US")} (${b.eth} SepETH)`;
} catch (err) {
  balance = `unavailable (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`;
}

// ── the presenter's copy: a recurring buy already adopted ──────────────────
// After the funding: its bar is measured against the pot (the 30% rule).
// Proposed as the agent's tool proposes it, approved by the three seeded seats
// (seeded approvals, like the seats), adopted by the same executeIfQuorum an
// approval runs — so the presenter can run a week's buy from the first minute.
let recurring = "—";
if (MINE) {
  const { recurringBuyStatus, proposeRecurringBuy } = await import("../src/lib/agent/treasury/recurring");
  const { executeIfQuorum } = await import("../src/lib/agent/treasury/approvals");
  const before = await recurringBuyStatus(roomId);
  if (before.live) recurring = `live — ${before.live.weeklyUsd}/week for ${before.live.weeks} weeks`;
  else {
    const proposed = before.pending
      ? { ok: true as const, actionId: before.pending.actionId }
      : await proposeRecurringBuy({ roomId, agentUserId, requesterId: ids.alex, weeklyUsd: 20, weeks: 12 });
    if (!proposed.ok) throw new Error(`the recurring buy was not queued: ${proposed.reason}`);
    await db
      .insert(S.treasuryApprovals)
      .values(PRESEATED.map((k) => ({ actionId: proposed.actionId, userId: ids[k], approverKey: `sub:seed:${ids[k]}`, verificationLevel: "dev-simulator" })))
      .onConflictDoNothing();
    const adopted = await executeIfQuorum(proposed.actionId);
    recurring = adopted.executed ? "adopted now — $20/week for 12 weeks" : `NOT adopted (${adopted.approvals}/${adopted.required}${adopted.error ? `, ${adopted.error}` : ""})`;
    if (!adopted.executed) failed = true;
  }
}

// what the treasury will actually read back from the doc just written
const { loadRelationTreasury } = await import("../src/lib/agent/treasury/memory");
const rt = await loadRelationTreasury(roomId);
if (!rt) throw new Error("the treasury does not see a Treasury Rules section — memory.ts and this seed disagree on the layout");
if (rt.policy.unparsed.length) {
  failed = true;
  console.warn(`WARNING: ${rt.policy.unparsed.length} rule line(s) did not parse — the policy is fail-closed:\n  ${rt.policy.unparsed.join("\n  ")}`);
}
if (!rt.adoptedAt) {
  failed = true;
  console.warn("WARNING: the rules are not adopted — the agent will move no money");
} else if (rt.proposal && JOIN_ALEX2 && rt.proposal.joined.length === 1 && !rt.proposal.added.length && !rt.proposal.removed.length) {
  console.log("the 2nd account joined after the adoption (--join-alex2): in the room, no vote until the relation adopts its membership");
} else if (rt.proposal) {
  console.warn(
    `NOTE: the doc differs from the adopted rules (${rt.proposal.added.length} added, ${rt.proposal.removed.length} removed, ${rt.proposal.joined.length} new member(s)) — the agent follows the adopted version; --reset starts over`
  );
}

const seated = await db
  .select({ userId: S.treasurySeats.userId })
  .from(S.treasurySeats)
  .where(eq(S.treasurySeats.roomId, roomId));
const nameOf = (id: string) => PEOPLE.find((p) => ids[p.key] === id)?.name ?? id;

console.log(`
"${ROOM}" ready${written.length ? ` — wrote ${written.join(", ")}` : ""}
  room       ${roomId}   ${APP}/dm/${roomId}
  workspace  ${ws.id}   "${WORKSPACE}"
  agent      ${agentUserId}   "${ROOM} agent"
  wallet     ${address}   balance ${balance}
  funding    ${funding}
  doc        ${APP}/p/${okfDocPageId(tree.rootPath)}   (${tree.rootPath})
  rules      ${APP}/p/${rt.rulesPageId}   ${rt.policy.rules.length} rules, ${rt.policy.unparsed.length} unparsed · adopted ${rt.adoptedAt ?? "never"}${adoptedNow ? " (now)" : ""}
  payees     ${rt.payees.map((p) => `${p.name} → ${p.address}`).join(", ") || "none"}
  members    ${IN_ROOM.map((p) => p.name).join(", ")}${JOIN_ALEX2 ? " + Alex (2nd account), joined after the adoption" : TRY ? "" : " — Alex (2nd account) is in the workspace, not the room"}
  seats      ${seated.map((s) => nameOf(s.userId)).join(", ") || "none"}${MINE ? `
  recurring  ${recurring}
  presenter  ${MINE} — MetaMask login lands on Alex's account
  ids        ${PEOPLE.map((p) => `${p.key}=${ids[p.key]}`).join(" ")}` : ""}
  logins     POST ${APP}/api/auth/demo-login { "as": "<slug>" }
${PEOPLE.map((p) => `               ${p.slug.padEnd(12)} ${p.name}`).join("\n")}`);
process.exit(failed ? 1 : 0);
