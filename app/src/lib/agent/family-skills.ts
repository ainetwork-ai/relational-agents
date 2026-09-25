import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, pages, teamspaces, users } from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { runAsOrService } from "@/lib/aindrive-account";
import { aindrivePublicBase, listTree, notUserFolder, readFile, readFileBytes } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { readExif, type PhotoExif } from "@/lib/exif";
import { formatUsdc, giftValid, ledgerBalance, ledgerDriveOf, payGift, unlocked, type GiftContent } from "@/lib/gift";
import { b, createAgentDatabase, writeAgentPage, type NewBlock } from "./agent-pages";
import type { DriveSource } from "./shared-drives";

/**
 * What a family room's agent can DO, beyond answering — each reads the folders
 * the family shared (as whoever shared them), writes a page into the teamspace
 * those files came from, and says in the chat where it is:
 *
 *   요리      "녹두전 4인분 장보기 목록 만들어줘"  → recipe scaled, a checklist
 *   녹음      "녹음에서 할 일 뽑아줘"              → a to-do board from a recording
 *   앨범      "제주 앨범 정리해줘"                  → photos from every phone, by day
 *   용돈      "서연이 용돈 주고 영상 보자"          → an x402 payment opens a gift
 *
 * Matched by what the sentence asks for, not left to the model: these write
 * pages and move money, and "maybe" is not a state either may be in.
 */

export type FamilySkill = "shopping" | "todos" | "album" | "allowance";

export function matchFamilySkill(text: string): FamilySkill | null {
  const t = text.replace(/\s+/g, " ");
  if (/용돈/.test(t) && /(영상|열어|열자|보자|보내|줘|주고|주자)/.test(t)) return "allowance";
  if (/녹음/.test(t) && /(할 ?일|todo|투두|정리|뽑|목록)/i.test(t)) return "todos";
  if (/앨범/.test(t) && /(정리|만들|모아|묶)/.test(t)) return "album";
  if (/(장보기|장 볼|재료)/.test(t) && /(목록|리스트|만들|정리|알려)/.test(t)) return "shopping";
  if (/\d+\s*인분/.test(t) && /(만들|목록|장보기|알려)/.test(t)) return "shopping";
  return null;
}

export interface SkillContext {
  workspaceId: string;
  askerId: string;
  sources: DriveSource[];
  text: string;
}

export interface SkillResult {
  text: string;
  pageId?: string;
}

// ── shared helpers ──────────────────────────────────────────────────────────

interface Found {
  src: DriveSource;
  /** path inside the shared folder */
  rel: string;
  /** path inside the drive */
  full: string;
}

async function listAll(sources: DriveSource[]): Promise<Found[]> {
  const out: Found[] = [];
  await Promise.all(
    sources.map(async (src) => {
      const files = await runAsOrService(src.linkedBy, () => listTree(src.link, 400, 80, notUserFolder)).catch(() => [] as string[]);
      for (const rel of files)
        if (!/(^|\/)ainmem-|(^|\/)\.aindrive\//.test(rel)) out.push({ src, rel, full: [src.link.root, rel].filter(Boolean).join("/") });
    })
  );
  return out;
}

const read = (f: Found) => runAsOrService(f.src.linkedBy, () => readFile(f.src.link, f.rel));
const readBytes = (f: Found) => runAsOrService(f.src.linkedBy, () => readFileBytes(f.src.link, f.rel, 20 * 1024 * 1024));
const base = () => aindrivePublicBase() ?? "";
const urlOf = (f: Found) => aindriveFileUrl(base(), { driveId: f.src.link.driveId, path: f.full });
const nameOf = (p: string) => p.split("/").pop() ?? p;
const who = (f: Found) => f.src.ownerName ?? f.src.label;

async function llmJson<T>(system: string, user: string, maxTokens = 1200): Promise<T | null> {
  const raw = await aiChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens, temperature: 0 }
  ).catch(() => "");
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    return JSON.parse((fenced ? fenced[1] : raw).trim().replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "")) as T;
  } catch {
    return null;
  }
}

async function teamspaceOf(f: Found | undefined, workspaceId: string): Promise<{ id: string; name: string; private: boolean } | null> {
  const id = f?.src.teamspaceId;
  const rows = id
    ? await db.select().from(teamspaces).where(eq(teamspaces.id, id))
    : await db.select().from(teamspaces).where(eq(teamspaces.workspaceId, workspaceId)).limit(1);
  const t = rows[0];
  return t ? { id: t.id, name: t.name, private: t.visibility === "private" } : null;
}

// ── 1. 요리: recipe → scaled shopping list ─────────────────────────────────

async function shopping(ctx: SkillContext): Promise<SkillResult> {
  const files = await listAll(ctx.sources);
  const recipes = files.filter((f) => /(^|\/)레시피\//.test(f.full) && /\.md$/i.test(f.rel) && !/계량/.test(f.rel));
  const dishOf = (f: Found) => nameOf(f.rel).replace(/\.md$/i, "");
  const recipe = recipes.find((f) => ctx.text.includes(dishOf(f)));
  if (!recipe)
    return {
      text: recipes.length
        ? `어떤 음식인지 알려 주세요. 가족이 공유한 레시피: ${recipes.map(dishOf).join(", ")}`
        : "가족이 공유한 폴더에서 레시피를 찾지 못했어요.",
    };
  const dish = dishOf(recipe);
  const servings = Number(ctx.text.match(/(\d+)\s*인분/)?.[1] ?? 4);
  const measure = files.find((f) => f.src === recipe.src && /계량/.test(f.rel));
  const [recipeText, measureText] = await Promise.all([read(recipe), measure ? read(measure) : Promise.resolve("")]);
  const plan = await llmJson<{ originalServings?: number; items?: { name: string; amount: string; note?: string }[]; steps?: string[] }>(
    "You turn a Korean family recipe into a shopping list for a different number of servings. Use the household measure table when given " +
      '("한 줌" → grams). Output JSON only: {"originalServings":<number the recipe makes>,"items":[{"name":"<재료>","amount":"<scaled amount, Korean units or grams>","note":"<short tip or empty>"}],' +
      '"steps":["<short Korean step>", …3 to 6]}. Keep every ingredient; do not invent any.',
    `## 레시피\n${recipeText.slice(0, 5000)}\n\n## 계량법\n${measureText.slice(0, 2000)}\n\n## 원하는 양\n${servings}인분`
  );
  if (!plan?.items?.length) return { text: `${dish} 레시피를 읽었는데 재료를 정리하지 못했어요. 한 번 더 말해 주세요.` };
  const media = files.filter((f) => f.src === recipe.src && f !== recipe && nameOf(f.rel).includes(dish));
  const review = files.find((f) => /후기/.test(f.rel) && nameOf(f.rel).includes(dish));
  const ts = await teamspaceOf(recipe, ctx.workspaceId);
  if (!ts) return { text: "레시피가 있는 팀스페이스를 찾지 못했어요." };
  const title = `${dish} ${servings}인분 장보기`;
  const body: NewBlock[] = [
    b.callout(
      "🛒",
      `${who(recipe)}의 ${dish} 레시피(${plan.originalServings ?? "?"}인분 기준)를 ${servings}인분으로 맞췄어요.` +
        (measure ? " 「한 줌」 같은 단위는 할머니 계량법으로 바꿨어요." : "")
    ),
    b.h2("장볼 것"),
    ...plan.items.map((i) => b.todo(`${i.name} ${i.amount}${i.note ? ` — ${i.note}` : ""}`)),
    b.h2("만드는 법 (요약)"),
    ...(plan.steps ?? []).map((s) => b.num(s)),
    b.h2(`${who(recipe)}의 자료`),
    b.file(urlOf(recipe), nameOf(recipe.rel)),
    ...media.map((f) => b.file(urlOf(f), nameOf(f.rel))),
    ...(measure ? [b.file(urlOf(measure), nameOf(measure.rel))] : []),
    ...(review ? [b.h2("해 본 사람 후기"), b.file(urlOf(review), `${nameOf(review.rel)} — ${who(review)}`)] : []),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "🛒", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      `${dish} ${servings}인분 장보기 목록을 만들었어요 → /p/${pageId}\n` +
      plan.items.slice(0, 6).map((i) => `- ${i.name} ${i.amount}`).join("\n") +
      (plan.items.length > 6 ? `\n… 외 ${plan.items.length - 6}가지` : "") +
      `\n출처: ${who(recipe)} 폰 — ${[recipe, ...media].map((m) => nameOf(m.rel)).join(", ")}`,
  };
}

// ── 2. 녹음: a recording's transcript → a to-do board ─────────────────────

async function todos(ctx: SkillContext): Promise<SkillResult> {
  const files = await listAll(ctx.sources);
  const audio = files.filter((f) => /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.rel));
  const pairs = audio
    .map((a) => ({ audio: a, text: files.find((t) => t.src === a.src && t.rel === a.rel.replace(/\.[^.]+$/, ".txt")) }))
    .filter((p): p is { audio: Found; text: Found } => !!p.text)
    .sort((x, y) => nameOf(y.audio.rel).localeCompare(nameOf(x.audio.rel)));
  const pick = pairs[0];
  if (!pick) return { text: "공유된 폴더에서 받아쓰기(.txt)가 있는 녹음을 찾지 못했어요." };
  const transcript = await read(pick.text);
  const out = await llmJson<{ title?: string; date?: string; tasks?: { task: string; owner: string; due?: string | null; note?: string }[] }>(
    "You read a Korean family meeting transcript and list every action item someone took on. Resolve dates against the meeting date " +
      '(the year is in the header). Output JSON only: {"title":"<short Korean meeting title>","date":"YYYY-MM-DD",' +
      '"tasks":[{"task":"<what, short Korean>","owner":"<who: one person\'s name as spoken, e.g. 엄마/아빠/서연/도윤, or 모두>","due":"YYYY-MM-DD or null","note":"<detail or empty>"}]}.',
    transcript.slice(0, 6000),
    1500
  );
  if (!out?.tasks?.length) return { text: "녹음을 읽었는데 할 일을 찾지 못했어요." };
  const ts = await teamspaceOf(pick.audio, ctx.workspaceId);
  if (!ts) return { text: "녹음이 있는 팀스페이스를 찾지 못했어요." };
  const palette = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];
  const owners = [...new Set(out.tasks.map((t) => t.owner).filter(Boolean))];
  const dbId = await createAgentDatabase({
    workspaceId: ctx.workspaceId,
    byUserId: ctx.askerId,
    title: `${out.title ?? "회의"} — 할 일`,
    columns: [
      { name: "할 일", type: "title" },
      { name: "담당", type: "select", options: owners.map((o, i) => ({ name: o, color: palette[i % palette.length] })) },
      { name: "기한", type: "date" },
      { name: "상태", type: "select", options: [{ name: "할 일", color: "gray" }, { name: "진행 중", color: "blue" }, { name: "완료", color: "green" }] },
      { name: "메모", type: "text" },
    ],
    rows: out.tasks.map((t) => ({ "할 일": t.task, 담당: t.owner, 기한: t.due ?? null, 상태: "할 일", 메모: t.note ?? "" })),
    views: [
      { name: "담당별", type: "board", groupBy: "담당", hide: ["담당"] },
      { name: "진행", type: "board", groupBy: "상태", hide: ["상태"] },
      { name: "기한", type: "calendar", date: "기한" },
      { name: "표", type: "table" },
    ],
  });
  const title = `${out.title ?? "회의"} — 할 일`;
  const body: NewBlock[] = [
    b.callout(
      "🎙️",
      `${who(pick.audio)} 폰의 녹음(${nameOf(pick.audio.rel)})에서 뽑은 할 일 ${out.tasks.length}개예요.` +
        (ts.private ? ` 🤫 이 팀스페이스(${ts.name})에만 있어요 — 멤버가 아닌 가족에게는 보이지 않아요.` : "")
    ),
    b.database(dbId),
    b.h2("녹음"),
    b.file(urlOf(pick.audio), nameOf(pick.audio.rel)),
    b.file(urlOf(pick.text), nameOf(pick.text.rel)),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "✅", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      `녹음에서 할 일 ${out.tasks.length}개를 뽑아 보드로 만들었어요 → /p/${pageId}\n` +
      out.tasks.map((t) => `- ${t.owner}: ${t.task}${t.due ? ` (~${t.due.slice(5).replace("-", "/")})` : ""}`).join("\n"),
  };
}

// ── 3. 앨범: photos from every phone, by day, duplicates once ──────────────

const REGIONS: Record<string, [number, number, number, number]> = {
  제주: [33.0, 33.7, 126.0, 127.1],
};
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

async function album(ctx: SkillContext): Promise<SkillResult> {
  const files = await listAll(ctx.sources);
  const images = files.filter((f) => /\.(jpe?g)$/i.test(f.rel));
  const shots: { f: Found; ex: PhotoExif; hash: string }[] = [];
  for (let i = 0; i < images.length; i += 4)
    await Promise.all(
      images.slice(i, i + 4).map(async (f) => {
        const bytes = await readBytes(f).catch(() => null);
        if (!bytes) return;
        const ex = readExif(bytes);
        if (ex.takenAt) shots.push({ f, ex, hash: createHash("sha1").update(bytes).digest("hex") });
      })
    );
  const inRegion = (r: string, x: PhotoExif) => {
    const [la0, la1, lo0, lo1] = REGIONS[r];
    return x.lat !== undefined && x.lon !== undefined && x.lat >= la0 && x.lat <= la1 && x.lon >= lo0 && x.lon <= lo1;
  };
  const asked = Object.keys(REGIONS).find((r) => ctx.text.includes(r));
  let pick = asked ? shots.filter((s) => inRegion(asked, s.ex)) : shots;
  if (!asked) {
    // "오늘 여행사진" / "여행 사진": the trip — the run of back-to-back days with
    // photos that holds today, or else the latest one
    const days = [...new Set(pick.map((s) => s.ex.takenAt!.slice(0, 10)))].sort();
    const runs: string[][] = [];
    for (const d of days) {
      const prev = runs[runs.length - 1];
      const gap = prev ? (Date.parse(d) - Date.parse(prev[prev.length - 1])) / 86_400_000 : Infinity;
      if (prev && gap <= 1) prev.push(d);
      else runs.push([d]);
    }
    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10); // KST
    const run = runs.find((r) => r.includes(today)) ?? runs[runs.length - 1] ?? [];
    pick = pick.filter((s) => run.includes(s.ex.takenAt!.slice(0, 10)));
  }
  if (!pick.length) return { text: `공유된 폴더에서 ${asked ? `${asked}에서 ` : ""}찍은 사진(촬영 정보 있는)을 찾지 못했어요.` };
  // name the album for where the photos were taken, when they all agree
  const region = asked ?? Object.keys(REGIONS).find((r) => pick.every((s) => inRegion(r, s.ex)));
  // the same photo sent around the family is one photo
  const seen = new Set<string>();
  const dupes: typeof pick = [];
  // of two copies, keep the one on the phone that took it, not one passed along
  const forwarded = (f: Found) => (/(보냄|받음|받은|복사|copy|kakao)/i.test(nameOf(f.rel)) ? 1 : 0);
  pick = pick
    .sort((a, b2) => a.ex.takenAt!.localeCompare(b2.ex.takenAt!) || forwarded(a.f) - forwarded(b2.f))
    .filter((s) => (seen.has(s.hash) ? (dupes.push(s), false) : (seen.add(s.hash), true)));
  const days = [...new Set(pick.map((s) => s.ex.takenAt!.slice(0, 10)))];
  const phones = [...new Set(pick.map((s) => who(s.f)))];
  const docs = files.filter((f) => /여행\//.test(f.full) && /(계획|경비|브리핑)/.test(f.rel));
  const ts = await teamspaceOf(pick[0].f, ctx.workspaceId);
  if (!ts) return { text: "사진이 있는 팀스페이스를 찾지 못했어요." };
  const place = (f: Found) => nameOf(f.rel).replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const body: NewBlock[] = [
    b.callout(
      "📸",
      `${phones.join(" · ")}의 폰에서 ${region ? `${region} ` : ""}사진 ${pick.length}장을 찍은 시각·위치로 모아 날짜별로 정리했어요.` +
        (dupes.length ? ` 같은 사진 ${dupes.length}장(서로 주고받은 것)은 한 번만 넣었어요.` : "") +
        " 할머니, 보시고 댓글 남겨 주세요!"
    ),
    ...days.flatMap((d, i) => {
      const dt = new Date(`${d}T00:00:00`);
      const daily = pick.filter((s) => s.ex.takenAt!.startsWith(d));
      return [
        b.h2(`${i + 1}일차 · ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WEEKDAY[dt.getDay()]})`),
        ...daily.map((s) => b.file(urlOf(s.f), `${s.ex.takenAt!.slice(11, 16)} · ${place(s.f)} — ${who(s.f)} 폰${s.ex.model ? ` (${s.ex.model})` : ""}`)),
      ];
    }),
    ...(docs.length ? [b.h2("여행 계획과 경비"), ...docs.map((f) => b.file(urlOf(f), `${nameOf(f.rel)} — ${who(f)}`))] : []),
  ];
  const title = `${region ?? "가족"} 여행 앨범`;
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "📸", byUserId: ctx.askerId, blocks: body, fullWidth: true });
  return {
    pageId,
    text:
      `${title}을 만들었어요 → /p/${pageId}\n` +
      `${phones.join(" · ")} 폰의 사진 ${pick.length}장, ${days.length}일로 나눴어요` +
      (dupes.length ? ` (겹친 사진 ${dupes.length}장은 뺐어요)` : "") +
      ".\n" +
      days.map((d, i) => `- ${i + 1}일차 ${d.slice(5).replace("-", "/")}: ${pick.filter((s) => s.ex.takenAt!.startsWith(d)).map((s) => place(s.f)).join(", ")}`).join("\n"),
  };
}

// ── 4. 용돈: pay a gift over x402 and open it ──────────────────────────────

async function allowance(ctx: SkillContext): Promise<SkillResult> {
  const rows = await db
    .select({ content: blocks.content, pageId: blocks.pageId })
    .from(blocks)
    .innerJoin(pages, eq(pages.id, blocks.pageId))
    .where(sql`${pages.workspaceId} = ${ctx.workspaceId} and ${blocks.content}->'gift' is not null`);
  const gifts = rows
    .map((r) => ({ gift: (r.content as { gift?: unknown }).gift, pageId: r.pageId }))
    .filter((g): g is { gift: GiftContent; pageId: string } => giftValid(g.gift));
  const named = gifts.filter((g) => ctx.text.includes(g.gift.spec.recipientName.replace(/이$/, "")));
  const target = named[0] ?? (gifts.length === 1 ? gifts[0] : undefined);
  if (!target)
    return {
      text: gifts.length
        ? `누구 영상을 열까요? ${gifts.map((g) => `${g.gift.spec.recipientName}의 「${g.gift.spec.title}」`).join(", ")}`
        : "용돈으로 여는 선물 영상이 아직 없어요.",
    };
  const { spec } = target.gift;
  if (spec.recipientUserId === ctx.askerId) return { text: "자기 영상은 용돈 없이 볼 수 있어요 🙂" };
  if (unlocked(target.gift)) return { pageId: target.pageId, text: `「${spec.title}」은 이미 열렸어요 → /p/${target.pageId}` };
  const r = await payGift(ctx.askerId, spec.id);
  if (!r.ok) return { text: `용돈을 보내지 못했어요: ${r.error}` };
  const payerDrive = await ledgerDriveOf(ctx.askerId);
  const left = payerDrive ? await ledgerBalance(ctx.askerId, payerDrive) : null;
  const [asker] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.askerId));
  return {
    pageId: target.pageId,
    text:
      `🎁 ${spec.recipientName}에게 용돈 ${spec.amountKrw.toLocaleString("ko-KR")}원(${formatUsdc(spec.amount)} USDC)을 보냈어요. ` +
      `x402로 결제했고 「${spec.title}」이 열렸어요 → /p/${target.pageId}\n` +
      `영수증 ${r.receipt}` +
      (left !== null ? ` · ${asker?.name ?? ""} 용돈 장부 잔액 ${left.toLocaleString("ko-KR")}원` : "") +
      ` (장부는 각자의 aindrive 「지갑/」 폴더에 적혔어요)`,
  };
}

export async function runFamilySkill(skill: FamilySkill, ctx: SkillContext): Promise<SkillResult> {
  switch (skill) {
    case "shopping":
      return shopping(ctx);
    case "todos":
      return todos(ctx);
    case "album":
      return album(ctx);
    case "allowance":
      return allowance(ctx);
  }
}
