/**
 * The family demo's workspace: the Kim family's, put together from the three
 * aindrive folders grandma, mom and dad each share.
 *
 *   pnpm demo:family [--home ~/.ainmem-demo] [--reset]
 *
 * Run scripts/family-demo-accounts.mts first — it makes the three people
 * (aindrive accounts + drives + ainmem accounts) and writes <home>/family.json.
 * This script then, as those people:
 *   1. makes mom's family workspace, with grandma and dad as members, and a
 *      family teamspace for the three of them;
 *   2. links each person's own drive into the teamspace (mom's first, so the
 *      teamspace's OKF backup lands in her drive);
 *   3. writes the 2026 Chuseok pages — schedule and the road home, roles, the
 *      ancestral table and food, tending the graves, grandma's health, gifts and
 *      pocket money, the album, Chuseok night — whose files are the family's aindrive files, linked, not
 *      copied: each file block holds the file's aindrive link and previews it;
 *   4. opens the family chat with its agent (family profile);
 *   5. points the demo login ("Start with the demo account", DEMO_LOGIN_ADDRESS) at mom.
 *
 * The Korean content it writes lives in src/i18n/content/family-seed.ts.
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
type PropType = import("../src/lib/db/schema").PropertyType;
const { listDrives, listTree } = await import("../src/lib/aindrive");
const { runAs } = await import("../src/lib/aindrive-account");
const { aindriveFileUrl } = await import("../src/lib/aindrive-url");
const { provisionRoomAgent } = await import("../src/lib/agent/provision");
const { runBackup } = await import("../src/lib/aindrive-backup");
const { deleteNode } = await import("../src/lib/okf-store");
const { SEED } = await import("../src/i18n/content/family-seed");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const RESET = process.argv.includes("--reset");
const WORKSPACE = SEED.workspace.name;
const TEAMSPACE = SEED.teamspace.name;

type Key = "grandma" | "mom" | "dad" | "seoyeon";
const KEYS: Key[] = ["grandma", "mom", "dad", "seoyeon"];
const family = JSON.parse(fs.readFileSync(path.join(HOME, "family.json"), "utf8")) as {
  aindrive: string;
  members: Record<Key, { name: string; drive: string; ainmemUserId: string }>;
};
const base = (process.env.AINDRIVE_PUBLIC_URL || process.env.AINDRIVE_SERVER || family.aindrive).replace(/\/+$/, "");
const M = family.members;
if (!M.seoyeon) throw new Error("no seoyeon in family.json — run scripts/family-demo-accounts.mts again (it adds her phone)");
const ids = Object.fromEntries(KEYS.map((k) => [k, M[k].ainmemUserId])) as Record<Key, string>;
// names first: a gift carries its maker's name, and the rooms greet by name
for (const k of KEYS) await db.update(S.users).set({ displayName: M[k].name }).where(eq(S.users.id, ids[k]));

// ── each person's drive, and every file in it ───────────────────────────────

const drive: Record<Key, { id: string; files: string[] }> = {} as never;
for (const k of KEYS) {
  const found = await runAs(ids[k], async () => {
    const d = (await listDrives()).find((x) => x.name === M[k].drive);
    if (!d) throw new Error(`${M[k].name}: no drive named "${M[k].drive}" — is its aindrive CLI running?`);
    return { id: d.id, files: await listTree({ driveId: d.id, root: "" }, 500) };
  });
  drive[k] = found;
  console.log(`${M[k].name}: drive ${found.id}, ${found.files.length} files`);
}
const fileUrl = (k: Key, p: string) => aindriveFileUrl(base, { driveId: drive[k].id, path: p });
const has = (k: Key, p: string) => drive[k].files.includes(p);
const under = (k: Key, dir: string, ext?: RegExp) =>
  drive[k].files.filter((f) => f.startsWith(`${dir}/`) && (!ext || ext.test(f))).sort();

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
    // the family agent's record lives as OKF files, outside the workspace
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
  .values({ name: WORKSPACE, iconText: "🏡", description: SEED.workspace.description, createdBy: ids.mom })
  .returning();
// Signing in made each of them a personal workspace first, and with no
// workspace picked the app lands on the oldest one a person owns (then the
// oldest membership) — so this membership is dated before theirs, and mom,
// who owns it, lands on the family workspace (the demo login is her).
const firstJoined = await db
  .select({ at: S.workspaceMembers.joinedAt })
  .from(S.workspaceMembers)
  .where(inArray(S.workspaceMembers.userId, KEYS.map((k) => ids[k])))
  .orderBy(S.workspaceMembers.joinedAt)
  .limit(1);
const joinedAt = new Date((firstJoined[0]?.at ?? new Date()).getTime() - 60_000);
await db.insert(S.workspaceMembers).values([
  { workspaceId: ws.id, userId: ids.mom, role: "owner", joinedAt },
  { workspaceId: ws.id, userId: ids.dad, role: "member", joinedAt },
  { workspaceId: ws.id, userId: ids.grandma, role: "member", joinedAt },
  { workspaceId: ws.id, userId: ids.seoyeon, role: "member", joinedAt },
]);
const [ts] = await db
  .insert(S.teamspaces)
  .values({ workspaceId: ws.id, name: TEAMSPACE, icon: "🏡", description: SEED.teamspace.description, createdBy: ids.mom })
  .returning();
await db.insert(S.teamspaceMembers).values(
  KEYS.map((k) => ({ teamspaceId: ts.id, userId: ids[k], role: k === "mom" ? "owner" : "member" }))
);
// grandma's birthday is planned behind her back: a private teamspace for the
// others. Nothing in it reaches her — not the pages, not the recording, and not
// the family agent when she is in the room (it only reads what all can see).
const [secret] = await db
  .insert(S.teamspaces)
  .values({
    workspaceId: ws.id,
    name: SEED.secret.name,
    icon: "🎂",
    description: SEED.secret.description,
    visibility: "private",
    createdBy: ids.mom,
  })
  .returning();
await db.insert(S.teamspaceMembers).values(
  (["mom", "dad", "seoyeon"] as Key[]).map((k) => ({ teamspaceId: secret.id, userId: ids[k], role: k === "mom" ? "owner" : "member" }))
);
// each person shares their own drive; mom's first, so the OKF backup goes there
for (const k of ["mom", "grandma", "dad"] as Key[]) {
  await db.insert(S.teamspaceDrives).values({
    teamspaceId: ts.id,
    name: M[k].drive,
    driveId: drive[k].id,
    root: "",
    createdBy: ids[k],
    backup: k === "mom",
  });
}
// seoyeon shares folders, not her whole phone: her album with the family, the
// birthday plan with the secret teamspace. Her special-video folder stays
// hers — it opens only through the x402 gift below.
await db.insert(S.teamspaceDrives).values([
  { teamspaceId: ts.id, name: SEED.seoyeonShares.album.name, driveId: drive.seoyeon.id, root: SEED.seoyeonShares.album.root, createdBy: ids.seoyeon, backup: false },
  { teamspaceId: secret.id, name: SEED.seoyeonShares.birthday.name, driveId: drive.seoyeon.id, root: SEED.seoyeonShares.birthday.root, createdBy: ids.seoyeon, backup: true },
]);

// ── pages ────────────────────────────────────────────────────────────────────

type B = { type: BlockType; content: BlockContent };
const h2 = (text: string): B => ({ type: "heading2", content: { text } });
const p = (text: string): B => ({ type: "paragraph", content: { text } });
const callout = (icon: string, text: string): B => ({ type: "callout", content: { text, icon } });
const divider = (): B => ({ type: "divider", content: {} });
/** a file from someone's drive — linked, previewed, never copied */
const file = (k: Key, rel: string): B[] =>
  has(k, rel) ? [{ type: "file", content: { url: fileUrl(k, rel), text: rel.split("/").pop() } }] : [];
const files = (k: Key, rels: string[]) => rels.flatMap((r) => file(k, r));
const from = (k: Key) => p(SEED.from(M[k].name, M[k].drive));

let pagePos = 0;
async function page(title: string, icon: string, body: B[], by: Key = "mom", teamspaceId: string = ts.id) {
  const [pg] = await db
    .insert(S.pages)
    .values({ workspaceId: ws.id, teamspaceId, title, icon, position: ++pagePos, createdBy: ids[by] })
    .returning();
  if (body.length)
    await db.insert(S.blocks).values(body.map((b, i) => ({ pageId: pg.id, type: b.type, content: b.content, position: i + 1 })));
  return pg;
}

// a database from one of the family's CSV files
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const localFile = (k: Key, rel: string) => path.join(HOME, "drives", k, rel);

async function csvDatabase(
  k: Key,
  rel: string,
  title: string,
  opts: {
    dateCol?: string;
    selectCols?: string[];
    numberCols?: string[];
    boardCol?: string;
    /** a select column's options in this order (the board's columns follow it) */
    optionOrder?: Record<string, string[]>;
  } = {}
) {
  if (!fs.existsSync(localFile(k, rel))) return null;
  const [header, ...data] = parseCsv(fs.readFileSync(localFile(k, rel), "utf8").replace(/^﻿/, ""));
  const [database] = await db.insert(S.databases).values({ workspaceId: ws.id, title, createdBy: ids[k] }).returning();
  const palette = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "gray", "brown"];
  const props = await db
    .insert(S.dbProperties)
    .values(
      header.map((name, i) => {
        const select = opts.selectCols?.includes(name);
        const order = opts.optionOrder?.[name] ?? [];
        const rank = (o: string) => (order.includes(o) ? order.indexOf(o) : order.length);
        const options = select
          ? [...new Set(data.map((r) => (r[i] ?? "").trim()).filter(Boolean))]
              .sort((a, b) => rank(a) - rank(b))
              .map((o, j) => ({
              id: crypto.randomUUID(),
              name: o,
              color: palette[j % palette.length],
            }))
          : undefined;
        const number = opts.numberCols?.includes(name);
        const type: PropType =
          i === 0 ? "title" : name === opts.dateCol ? "date" : select ? "select" : number ? "number" : "text";
        const config = options ? { options } : number ? { numberFormat: "comma" } : {};
        return { databaseId: database.id, name: name.trim(), type, config, position: i + 1 };
      })
    )
    .returning();
  await db.insert(S.dbRows).values(
    data.map((r, n) => ({
      databaseId: database.id,
      position: n + 1,
      createdBy: ids[k],
      updatedBy: ids[k],
      values: Object.fromEntries(
        props.map((pr, i) => {
          const v = (r[i] ?? "").trim();
          if (pr.type === "date") return [pr.id, v ? { start: v.slice(0, 10) } : null];
          if (pr.type === "select") return [pr.id, pr.config.options?.find((o) => o.name === v)?.id ?? null];
          if (pr.type === "number") return [pr.id, v && Number.isFinite(Number(v)) ? Number(v) : null];
          return [pr.id, v];
        })
      ),
    }))
  );
  const dateProp = props.find((pr) => pr.type === "date");
  const boardProp = opts.boardCol ? props.find((pr) => pr.name === opts.boardCol) : undefined;
  await db.insert(S.dbViews).values([
    ...(boardProp
      ? [
          {
            databaseId: database.id,
            name: SEED.views.board,
            type: "board" as const,
            // the column already says it — the card need not repeat it
            config: { groupByPropertyId: boardProp.id, hiddenProperties: [boardProp.id] },
            position: 0,
          },
        ]
      : []),
    ...(dateProp
      ? [{ databaseId: database.id, name: SEED.views.calendar, type: "calendar" as const, config: { calendarDatePropertyId: dateProp.id }, position: 1 }]
      : []),
    { databaseId: database.id, name: SEED.views.table, type: "table" as const, config: {}, position: 2 },
  ]);
  return database;
}

const { csv } = SEED;
const calendar = await csvDatabase("mom", csv.calendar.file, csv.calendar.title, { dateCol: csv.calendar.dateCol, selectCols: csv.calendar.selectCols });
const roles = await csvDatabase("mom", csv.roles.file, csv.roles.title, {
  selectCols: csv.roles.selectCols,
  boardCol: csv.roles.boardCol,
  optionOrder: csv.roles.optionOrder,
});
const gifts = await csvDatabase("mom", csv.gifts.file, csv.gifts.title, { selectCols: csv.gifts.selectCols, numberCols: csv.gifts.numberCols });
const meds = await csvDatabase("grandma", csv.meds.file, csv.meds.title, { selectCols: csv.meds.selectCols });
const dbBlock = (d: { id: string } | null): B[] => (d ? [{ type: "database", content: { databaseId: d.id } }] : []);

const oldPhotos = under("grandma", SEED.dirs.oldPhotos, /\.(jpe?g|png|webp)$/i);
const holidayPhotos = under("mom", SEED.dirs.holidayPhotos, /\.(jpe?g|png|webp)$/i);
const P = SEED.pages;

// ① who comes when — the three days, and the road there
const schedule = await page(P.schedule.title, "📅", [
  callout("🚗", P.schedule.callout),
  h2(P.schedule.days),
  ...file("mom", P.schedule.daysFile),
  h2(P.schedule.road),
  ...files("dad", P.schedule.roadFiles),
  h2(P.schedule.calendar),
  ...dbBlock(calendar),
]);

// ② who does what — one board for the three of them and the kids
const rolesPage = await page(P.roles.title, "🙋", [
  p(P.roles.intro),
  ...dbBlock(roles),
  ...file("mom", csv.roles.file),
]);

// ③ the table and the food — mom's plan, grandma's way, grandma's recipes
const table = await page(P.table.title, "🍡", [
  callout("🎑", P.table.callout),
  h2(P.table.momHeading),
  ...files("mom", P.table.momFiles),
  h2(P.table.orderHeading),
  ...file("grandma", P.table.orderFile),
  h2(P.table.recipesHeading),
  ...files("grandma", P.table.recipes),
  h2(P.table.shoppingHeading),
  ...file("mom", P.table.shoppingFile),
  from("grandma"),
]);

// ④ the ancestors — the grave, the way there
const grave = await page(P.grave.title, "🌾", [
  callout("🌾", P.grave.callout),
  ...file("dad", P.grave.planFile),
  h2(P.grave.wayHeading),
  ...file("grandma", P.grave.wayFile),
]);

// ⑤ grandma's care over the holiday
const health = await page(P.health.title, "💊", [
  callout("🩺", P.health.callout),
  ...file("grandma", P.health.holidayFile),
  h2(P.health.medsHeading),
  ...dbBlock(meds),
  h2(P.health.vitalsHeading),
  ...files("grandma", under("grandma", SEED.dirs.health, SEED.dirs.vitals)),
  ...file("grandma", P.health.clinicFile),
  from("grandma"),
]);

// ⑥ gifts and pocket money
const giftsPage = await page(P.gifts.title, "🎁", [...dbBlock(gifts), ...file("mom", csv.gifts.file)]);

// ⑦ three generations of Chuseok, from two drives
const album = await page(P.album.title, "📸", [
  p(P.album.intro),
  h2(P.album.oldHeading),
  ...file("grandma", P.album.storyFile),
  ...oldPhotos.flatMap((f) => file("grandma", f)),
  h2(P.album.ourHeading),
  ...holidayPhotos.flatMap((f) => file("mom", f)),
]);

// ⑧ the evening — games, the moon, and the family meeting after
const evening = await page(P.evening.title, "🎲", [
  h2(P.evening.yutHeading),
  ...file("dad", P.evening.yutFile),
  h2(P.evening.moonHeading),
  ...file("mom", P.evening.moonFile),
  h2(P.evening.meetingHeading),
  ...file("dad", P.evening.meetingFile),
]);

// ── after Chuseok: the four family scenarios ──────────────────────────────────

const hint = (text: string): B => callout("✨", text);

// ① cooking — grandma's recipe, card, video and measures; mom's try
const cooking = await page(P.cooking.title, "🥞", [
  callout("🍳", P.cooking.callout),
  h2(P.cooking.recipeHeading),
  ...files("grandma", P.cooking.grandmaFiles),
  h2(P.cooking.reviewHeading),
  ...file("mom", P.cooking.reviewFile),
  hint(P.cooking.hint),
]);

// ③ the trip — plan and budget here; the album is the agent's to make
const trip = await page(P.trip.title, "✈️", [
  callout("🧳", P.trip.callout),
  h2(P.trip.planHeading),
  ...files("dad", P.trip.files),
  hint(P.trip.hint),
], "dad");

// ④ seoyeon's album, and the gift: her video for grandma, behind x402
const { createGift } = await import("../src/lib/gift");
const giftVideo = SEED.gift.video;
const gift = has("seoyeon", giftVideo)
  ? await createGift(ids.seoyeon, {
      title: SEED.gift.title,
      driveId: drive.seoyeon.id,
      path: giftVideo,
      mime: "video/mp4",
      amountKrw: 50_000,
      previewUrl: fileUrl("seoyeon", SEED.gift.preview),
    })
  : null;
const seoyeonAlbum = await page(P.seoyeonAlbum.title, "📷", [
  ...file("seoyeon", P.seoyeonAlbum.albumFile),
  h2(P.seoyeonAlbum.jejuHeading),
  ...files("seoyeon", under("seoyeon", SEED.dirs.seoyeonJeju, /\.(jpe?g|png)$/i)),
  h2(P.seoyeonAlbum.giftHeading),
  ...(gift ? [{ type: "file" as const, content: { text: gift.spec.title, gift } as BlockContent }] : []),
  callout("💌", P.seoyeonAlbum.callout),
], "seoyeon");

// ② the birthday — only in the private teamspace
const birthday = await page(
  SEED.secret.name,
  "🎂",
  [
    callout("🤫", P.birthday.callout),
    h2(P.birthday.recordingHeading),
    ...files("seoyeon", P.birthday.recordingFiles),
    h2(P.birthday.hintsHeading),
    p(P.birthday.diaryNote),
    ...file("grandma", P.birthday.diaryFile),
    hint(P.birthday.hint),
  ],
  "mom",
  secret.id
);

const letter = file("grandma", P.hub.letterFile);
const hub = await page(P.hub.title, "🎑", [
  callout("🎑", P.hub.callout),
  h2(P.hub.prepare),
  ...[schedule, rolesPage, table, grave].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2(P.hub.care),
  ...[health, giftsPage].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2(P.hub.memories),
  ...[album, evening].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2(P.hub.after),
  ...[cooking, trip, seoyeonAlbum].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  ...(letter.length ? [divider(), h2(P.hub.letterHeading), ...letter] : []),
]);
// the hub first in the sidebar
await db.update(S.pages).set({ position: 0 }).where(eq(S.pages.id, hub.id));

// ── the family chat and its agent ───────────────────────────────────────────

const [room] = await db
  .insert(S.chatRooms)
  .values({ name: SEED.familyRoom.name, kind: "dm", workspaceId: ws.id, createdBy: ids.mom, consentAt: new Date() })
  .returning();
await db.insert(S.chatRoomMembers).values(KEYS.map((k) => ({ roomId: room.id, userId: ids[k] })));
await provisionRoomAgent(room, KEYS.map((k) => ids[k]), ids.mom);
const talk = SEED.familyRoom.talk as [Key, string][];
let t = Date.now() - talk.length * 60_000;
for (const [k, text] of talk)
  await db.insert(S.chatMessages).values({ roomId: room.id, authorId: ids[k], text, createdAt: new Date((t += 60_000)) });

// the birthday room: everyone but grandma, with its own agent
const [secretRoom] = await db
  .insert(S.chatRooms)
  .values({ name: SEED.secret.name, kind: "dm", workspaceId: ws.id, createdBy: ids.mom, consentAt: new Date() })
  .returning();
const planners: Key[] = ["mom", "dad", "seoyeon"];
await db.insert(S.chatRoomMembers).values(planners.map((k) => ({ roomId: secretRoom.id, userId: ids[k] })));
await provisionRoomAgent(secretRoom, planners.map((k) => ids[k]), ids.mom);
let t2 = Date.now() - 3 * 60_000;
for (const [k, text] of SEED.secretRoom.talk as [Key, string][])
  await db.insert(S.chatMessages).values({ roomId: secretRoom.id, authorId: ids[k], text, createdAt: new Date((t2 += 60_000)) });

// ── pocket-money ledgers, on each person's own device ───────────────────────
// x402 gifts settle here (src/lib/gift.ts): grandma and mom start with money
// to give, seoyeon with an empty book to receive into. Written over MCP, as them.
const { writeFile } = await import("../src/lib/aindrive");
const LEDGER_HEAD = SEED.ledgers.head;
for (const [k, rel, rows] of SEED.ledgers.books as [Key, string, string[]][])
  await runAs(ids[k], () => writeFile({ driveId: drive[k].id, root: "" }, rel, [LEDGER_HEAD, ...rows].join("\n") + "\n"));

// ── the demo login lands on mom ─────────────────────────────────────────────

const demo = (process.env.DEMO_LOGIN_ADDRESS ?? "").toLowerCase();
if (/^0x[0-9a-f]{40}$/.test(demo)) {
  // the address may sit on an older demo account — move it to mom
  await db.update(S.users).set({ ainAddress: null }).where(and(eq(S.users.ainAddress, demo)));
  await db.update(S.users).set({ ainAddress: demo, homeCoverUrl: "/covers/home-cover-family.jpg" }).where(eq(S.users.id, ids.mom));
  console.log(`demo login → mom`);
}

// the teamspace's first OKF sync into mom's drive, now rather than on the first edit
const synced = await runBackup(ts.id);
console.log(`OKF sync → 「${M.mom.drive}」: ${synced.files} files${synced.error ? ` (error: ${synced.error})` : ""}`);

const syncedSecret = await runBackup(secret.id);
console.log(`OKF sync → 「${SEED.seoyeonShares.birthday.name}」: ${syncedSecret.files} files${syncedSecret.error ? ` (error: ${syncedSecret.error})` : ""}`);

console.log(`\n"${WORKSPACE}" ready: workspace ${ws.id}, teamspace ${ts.id}, ${pagePos} pages, family chat ${room.id}, birthday room ${secretRoom.id}`);
console.log(`birthday page ${birthday.id} (private teamspace ${secret.id})`);
process.exit(0);
