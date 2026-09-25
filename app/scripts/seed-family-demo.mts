/**
 * The family demo's workspace: "김씨네 가족", put together from the three
 * aindrive folders grandma, mom and dad each share.
 *
 *   pnpm demo:family [--home ~/.ainmem-demo] [--reset]
 *
 * Run scripts/family-demo-accounts.mts first — it makes the three people
 * (aindrive accounts + drives + ainmem accounts) and writes <home>/family.json.
 * This script then, as those people:
 *   1. makes mom's family workspace, with grandma and dad as members, and a
 *      "우리 가족" teamspace for the three of them;
 *   2. links each person's own drive into the teamspace (mom's first, so the
 *      teamspace's OKF backup lands in her drive);
 *   3. writes the 2026 추석 pages — 일정·귀성길, 역할 분담, 차례상과 음식, 벌초·성묘,
 *      할머니 건강, 선물·용돈, 앨범, 추석 밤 — whose files are the family's aindrive files, linked, not
 *      copied: each file block holds the file's aindrive link and previews it;
 *   4. opens the family chat with its agent (family profile);
 *   5. points the demo login ("데모 계정으로 시작", DEMO_LOGIN_ADDRESS) at mom.
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

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const RESET = process.argv.includes("--reset");
const WORKSPACE = "김씨네 가족";
const TEAMSPACE = "우리 가족";

type Key = "grandma" | "mom" | "dad" | "seoyeon";
const KEYS: Key[] = ["grandma", "mom", "dad", "seoyeon"];
const family = JSON.parse(fs.readFileSync(path.join(HOME, "family.json"), "utf8")) as {
  aindrive: string;
  members: Record<Key, { name: string; drive: string; ainmemUserId: string }>;
};
const base = (process.env.AINDRIVE_PUBLIC_URL || process.env.AINDRIVE_SERVER || family.aindrive).replace(/\/+$/, "");
const M = family.members;
if (!M.seoyeon) throw new Error("no 서연 in family.json — run scripts/family-demo-accounts.mts again (it adds her phone)");
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
  .values({ name: WORKSPACE, iconText: "🏡", description: "할머니·엄마·아빠·서연의 aindrive를 모은 우리 가족 공간", createdBy: ids.mom })
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
  .values({ workspaceId: ws.id, name: TEAMSPACE, icon: "🏡", description: "2026 추석 — 일정, 역할, 차례상, 성묘, 할머니 약, 앨범", createdBy: ids.mom })
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
    name: "할머니 생신 준비",
    icon: "🎂",
    description: "12월 5일 할머니 생신 — 할머니께는 비밀",
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
// 서연 shares folders, not her whole phone: her album with the family, the
// birthday plan with the secret teamspace. 특별영상/ stays hers — it opens
// only through the x402 gift below.
await db.insert(S.teamspaceDrives).values([
  { teamspaceId: ts.id, name: "서연 앨범", driveId: drive.seoyeon.id, root: "앨범", createdBy: ids.seoyeon, backup: false },
  { teamspaceId: secret.id, name: "서연 폰 · 생신 준비", driveId: drive.seoyeon.id, root: "생신준비", createdBy: ids.seoyeon, backup: true },
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
const from = (k: Key) => p(`— ${M[k].name}의 aindrive 「${M[k].drive}」에서`);

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
            name: "보드",
            type: "board" as const,
            // the column already says it — the card need not repeat it
            config: { groupByPropertyId: boardProp.id, hiddenProperties: [boardProp.id] },
            position: 0,
          },
        ]
      : []),
    ...(dateProp
      ? [{ databaseId: database.id, name: "달력", type: "calendar" as const, config: { calendarDatePropertyId: dateProp.id }, position: 1 }]
      : []),
    { databaseId: database.id, name: "표", type: "table" as const, config: {}, position: 2 },
  ]);
  return database;
}

const calendar = await csvDatabase("mom", "가족일정/2026_가족달력.csv", "가족 일정", { dateCol: "날짜", selectCols: ["누구"] });
const roles = await csvDatabase("mom", "추석/역할분담.csv", "추석 역할 분담", {
  selectCols: ["담당", "상태"],
  boardCol: "상태",
  optionOrder: { 상태: ["할 일", "진행 중", "완료"] },
});
const gifts = await csvDatabase("mom", "추석/선물_용돈.csv", "선물 · 용돈", { selectCols: ["누가 준비", "상태"], numberCols: ["금액"] });
const meds = await csvDatabase("grandma", "건강/복약일정.csv", "할머니 복약 일정", { selectCols: ["용도"] });
const dbBlock = (d: { id: string } | null): B[] => (d ? [{ type: "database", content: { databaseId: d.id } }] : []);

const oldPhotos = under("grandma", "옛날사진", /\.(jpe?g|png|webp)$/i);
const holidayPhotos = under("mom", "사진", /\.(jpe?g|png|webp)$/i);

// ① who comes when — the three days, and the road there
const schedule = await page("추석 일정 · 귀성길", "📅", [
  callout("🚗", "9/24(목) 아침 7시 수원 출발 → 10시 강경 할머니 댁. 작은아버지네는 KTX로 18:41 논산역, 고모는 9/25 오후 합류."),
  h2("사흘 일정 — 엄마"),
  ...file("mom", "추석/추석_일정.md"),
  h2("귀성 · 귀경 — 아빠"),
  ...file("dad", "귀성/귀성길_계획.md"),
  ...file("dad", "자동차/정비기록.csv"),
  h2("가족 달력"),
  ...dbBlock(calendar),
]);

// ② who does what — one board for the three of them and the kids
const rolesPage = await page("역할 분담", "🙋", [
  p("엄마가 aindrive에 올린 역할 분담표예요. 상태를 바꾸면 여기서 모두에게 보입니다."),
  ...dbBlock(roles),
  ...file("mom", "추석/역할분담.csv"),
]);

// ③ the table and the food — mom's plan, grandma's way, grandma's recipes
const table = await page("차례상과 음식", "🍡", [
  callout("🎑", "우리 집은 할머니 뜻에 따라 밥·국 대신 송편과 토란국을 올려요. 차례는 9/25(금) 오전 8시."),
  h2("차례상 — 엄마"),
  ...file("mom", "추석/차례상_차림표.md"),
  ...file("mom", "추석/차례상_배치도.png"),
  h2("우리 집 차례 순서 — 할머니"),
  ...file("grandma", "추석/우리집_차례_순서.md"),
  h2("할머니 레시피"),
  ...file("grandma", "레시피/송편.md"),
  ...file("grandma", "레시피/토란국.md"),
  ...file("grandma", "레시피/녹두전.md"),
  ...file("grandma", "레시피/식혜.md"),
  h2("장보기"),
  ...file("mom", "추석/추석_장보기.xlsx"),
  from("grandma"),
]);

// ④ the ancestors — the grave, the way there
const grave = await page("벌초 · 성묘", "🌾", [
  callout("🌾", "벌초는 9/12에 아빠·작은아버지가 마쳤어요. 성묘는 추석 당일 10:30, 할머니는 댁에서 기다리세요."),
  ...file("dad", "벌초성묘/벌초_성묘_계획.md"),
  h2("선산 가는 길 — 할머니"),
  ...file("grandma", "추석/선산_가는길.md"),
]);

// ⑤ grandma's care over the holiday
const health = await page("할머니 건강 · 연휴 약", "💊", [
  callout("🩺", "명절엔 식사 시간이 들쭉날쭉해요. 추석 당일 아침 약은 차례 전 7시에 서연이가 챙겨요."),
  ...file("grandma", "건강/추석연휴_약챙기기.md"),
  h2("복약 일정"),
  ...dbBlock(meds),
  h2("혈압·혈당 · 병원 예약"),
  ...files("grandma", under("grandma", "건강", /혈압|혈당/)),
  ...file("grandma", "건강/병원예약.md"),
  from("grandma"),
]);

// ⑥ gifts and pocket money
const giftsPage = await page("선물 · 용돈", "🎁", [...dbBlock(gifts), ...file("mom", "추석/선물_용돈.csv")]);

// ⑦ three generations of Chuseok, from two drives
const album = await page("추석 앨범", "📸", [
  p("할머니의 옛날 사진과 이야기, 엄마의 명절 사진 — 두 사람의 aindrive에서 모았어요."),
  h2("할머니의 옛날 추석"),
  ...file("grandma", "옛날사진/사진_이야기.md"),
  ...oldPhotos.flatMap((f) => file("grandma", f)),
  h2("우리 집 명절"),
  ...holidayPhotos.flatMap((f) => file("mom", f)),
]);

// ⑧ the evening — games, the moon, and the family meeting after
const evening = await page("추석 밤 · 가족회의", "🎲", [
  h2("윷놀이 — 아빠"),
  ...file("dad", "추석/윷놀이_대진표.md"),
  h2("보름달 소원 — 엄마"),
  ...file("mom", "추석/보름달_소원.md"),
  h2("가족회의 (9/27 일)"),
  ...file("dad", "메모/가족회의_안건.docx"),
]);

// ── after 추석: the four family scenarios ──────────────────────────────────

const hint = (text: string): B => callout("✨", text);

// ① cooking — grandma's recipe, card, video and measures; mom's try
const cooking = await page("할머니 녹두전", "🥞", [
  callout("🍳", "추석 끝나고 수원 집에서 할머니 녹두전 도전! 레시피·손글씨·반죽 영상은 할머니 폰에서, 해 본 후기는 엄마 폰에서 왔어요."),
  h2("할머니 레시피"),
  ...file("grandma", "레시피/녹두전.md"),
  ...file("grandma", "레시피/손글씨_녹두전.jpg"),
  ...file("grandma", "레시피/녹두전_반죽농도.mp4"),
  ...file("grandma", "레시피/할머니_계량법.md"),
  h2("엄마가 해 본 후기"),
  ...file("mom", "요리/우리집_녹두전_후기.md"),
  hint("가족방에서 「@agent 녹두전 4인분 장보기 목록 만들어줘」 — 할머니 레시피와 계량법으로 장보기 체크리스트를 만들어요."),
]);

// ③ the trip — plan and budget here; the album is the agent's to make
const trip = await page("제주 가족여행", "✈️", [
  callout("🧳", "10월 3일~6일, 할머니는 무릎 때문에 이번엔 집에서 기다리셨어요. 사진은 아빠·엄마·서연의 폰에 흩어져 있어요."),
  h2("계획과 경비 — 아빠"),
  ...file("dad", "여행/제주_가족여행_계획.md"),
  ...file("dad", "여행/제주_여행경비.xlsx"),
  ...file("dad", "여행/제주_여행_브리핑.pptx"),
  hint("가족방에서 「@agent 제주 앨범 정리해줘」 — 세 폰의 사진을 찍은 날짜·위치로 모아, 같은 사진은 한 번만 넣어 앨범을 만들어요."),
], "dad");

// ④ 서연's album, and the gift: her video for grandma, behind x402
const { createGift } = await import("../src/lib/gift");
const giftVideo = "특별영상/할머니께_제주에서.mp4";
const gift = has("seoyeon", giftVideo)
  ? await createGift(ids.seoyeon, {
      title: "할머니께, 제주에서",
      driveId: drive.seoyeon.id,
      path: giftVideo,
      mime: "video/mp4",
      amountKrw: 50_000,
      previewUrl: fileUrl("seoyeon", "앨범/특별영상_미리보기.jpg"),
    })
  : null;
const seoyeonAlbum = await page("서연이 앨범", "📷", [
  ...file("seoyeon", "앨범/2026_서연_앨범.md"),
  h2("제주에서"),
  ...files("seoyeon", under("seoyeon", "앨범/2026-10_제주", /\.(jpe?g|png)$/i)),
  h2("할머니께 드리는 선물 🎁"),
  ...(gift ? [{ type: "file" as const, content: { text: gift.spec.title, gift } as BlockContent }] : []),
  callout(
    "💌",
    "용돈으로 열면 그 돈이 서연이 지갑으로 가요 (x402 결제). 영상 원본은 서연이 폰에만 있고, 가족 누구에게도 공유되지 않아요 — 이 선물로만 열려요. " +
      "가족방에서 「@agent 서연이 용돈 주고 영상 보자」라고 해도 돼요."
  ),
], "seoyeon");

// ② the birthday — only in the private teamspace
const birthday = await page(
  "할머니 생신 준비",
  "🎂",
  [
    callout("🤫", "할머니께는 비밀! 이 팀스페이스는 엄마·아빠·서연만 봐요. 서연 폰의 녹음은 여기에만 공유돼 있어요."),
    h2("10월 11일 준비 회의 녹음 — 서연 폰"),
    ...file("seoyeon", "생신준비/2026-10-11_할머니생신_준비회의.m4a"),
    ...file("seoyeon", "생신준비/2026-10-11_할머니생신_준비회의.txt"),
    h2("선물 힌트"),
    p("할머니 일기(할머니 폰, 가족에게 공유된 것)에 요즘 불편하신 것들이 적혀 있어요."),
    ...file("grandma", "메모/할머니_일기.md"),
    hint("생신 준비방에서 「@agent 할머니 생신인 거 알지? 선물 뭐 할까?」, 「@agent 녹음에서 할 일 뽑아줘」"),
  ],
  "mom",
  secret.id
);

const letter = file("grandma", "편지/손주에게.txt");
const hub = await page("2026 우리 가족 추석", "🎑", [
  callout(
    "🎑",
    "추석 연휴는 9월 24일(목)~26일(토), 추석 당일은 9월 25일. 올해도 강경 할머니 댁에 모여요. " +
      "할머니·엄마·아빠가 각자 aindrive에서 고른 폴더가 이 공간에 공유돼 있어요 — 파일은 각자의 기기에 그대로 있고, 여기서 함께 봅니다."
  ),
  h2("준비"),
  ...[schedule, rolesPage, table, grave].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2("챙길 것"),
  ...[health, giftsPage].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2("추억"),
  ...[album, evening].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  h2("추석 다음 이야기"),
  ...[cooking, trip, seoyeonAlbum].map((pg) => ({ type: "link_to_page" as const, content: { childPageId: pg.id } })),
  ...(letter.length ? [divider(), h2("할머니가 손주에게"), ...letter] : []),
]);
// the hub first in the sidebar
await db.update(S.pages).set({ position: 0 }).where(eq(S.pages.id, hub.id));

// ── the family chat and its agent ───────────────────────────────────────────

const [room] = await db
  .insert(S.chatRooms)
  .values({ name: "우리 가족", kind: "dm", workspaceId: ws.id, createdBy: ids.mom, consentAt: new Date() })
  .returning();
await db.insert(S.chatRoomMembers).values(KEYS.map((k) => ({ roomId: room.id, userId: ids[k] })));
await provisionRoomAgent(room, KEYS.map((k) => ids[k]), ids.mom);
const talk: [Key, string][] = [
  ["mom", "내일 추석이에요! 할머니 댁에 몇 시까지 가면 될까요?"],
  ["grandma", "점심 전에만 오너라. 송편 소는 깨로 넉넉히 해 두마."],
  ["dad", "저는 산적 맡을게요. 작은아버지네 논산역 픽업도 제가 갑니다 😄"],
  ["mom", "할머니 혈압약은 아침 식후 한 번이죠? 복약 일정 확인해 둘게요."],
];
let t = Date.now() - talk.length * 60_000;
for (const [k, text] of talk)
  await db.insert(S.chatMessages).values({ roomId: room.id, authorId: ids[k], text, createdAt: new Date((t += 60_000)) });

// the birthday room: everyone but grandma, with its own agent
const [secretRoom] = await db
  .insert(S.chatRooms)
  .values({ name: "할머니 생신 준비", kind: "dm", workspaceId: ws.id, createdBy: ids.mom, consentAt: new Date() })
  .returning();
const planners: Key[] = ["mom", "dad", "seoyeon"];
await db.insert(S.chatRoomMembers).values(planners.map((k) => ({ roomId: secretRoom.id, userId: ids[k] })));
await provisionRoomAgent(secretRoom, planners.map((k) => ids[k]), ids.mom);
let t2 = Date.now() - 3 * 60_000;
for (const [k, text] of [
  ["seoyeon", "어제 회의 녹음 생신준비 폴더에 올렸어요! 할머니 팀스페이스엔 안 보여요 🤫"],
  ["mom", "고마워 서연아. 할 일 정리해서 나눠 보자."],
] as [Key, string][])
  await db.insert(S.chatMessages).values({ roomId: secretRoom.id, authorId: ids[k], text, createdAt: new Date((t2 += 60_000)) });

// ── pocket-money ledgers, on each person's own device ───────────────────────
// x402 gifts settle here (src/lib/gift.ts): grandma and mom start with money
// to give, 서연 with an empty book to receive into. Written over MCP, as them.
const { writeFile } = await import("../src/lib/aindrive");
const LEDGER_HEAD = "날짜,내용,상대,금액(원),잔액(원),영수증";
for (const [k, rel, rows] of [
  ["grandma", "지갑/용돈_장부.csv", ["2026-09-01,용돈 지갑 채움 (연금),—,300000,300000,—"]],
  ["mom", "지갑/용돈_장부.csv", ["2026-09-01,용돈 지갑 채움,—,200000,200000,—"]],
  ["seoyeon", "지갑/받은_용돈.csv", []],
] as [Key, string, string[]][])
  await runAs(ids[k], () => writeFile({ driveId: drive[k].id, root: "" }, rel, [LEDGER_HEAD, ...rows].join("\n") + "\n"));

// ── the demo login lands on mom ─────────────────────────────────────────────

const demo = (process.env.DEMO_LOGIN_ADDRESS ?? "").toLowerCase();
if (/^0x[0-9a-f]{40}$/.test(demo)) {
  // the address may sit on an older demo account — move it to mom
  await db.update(S.users).set({ ainAddress: null }).where(and(eq(S.users.ainAddress, demo)));
  await db.update(S.users).set({ ainAddress: demo, homeCoverUrl: "/covers/home-cover-family.jpg" }).where(eq(S.users.id, ids.mom));
  console.log(`demo login → 엄마`);
}

// the teamspace's first OKF sync into mom's drive, now rather than on the first edit
const synced = await runBackup(ts.id);
console.log(`OKF sync → 「${M.mom.drive}」: ${synced.files} files${synced.error ? ` (error: ${synced.error})` : ""}`);

const syncedSecret = await runBackup(secret.id);
console.log(`OKF sync → 「서연 폰 · 생신 준비」: ${syncedSecret.files} files${syncedSecret.error ? ` (error: ${syncedSecret.error})` : ""}`);

console.log(`\n"${WORKSPACE}" ready: workspace ${ws.id}, teamspace ${ts.id}, ${pagePos} pages, family chat ${room.id}, birthday room ${secretRoom.id}`);
console.log(`birthday page ${birthday.id} (private teamspace ${secret.id})`);
process.exit(0);
