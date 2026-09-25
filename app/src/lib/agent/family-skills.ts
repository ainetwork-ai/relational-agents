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
  if (/(용돈|pocket money|allowance)/i.test(t) && /(영상|열어|열자|보자|보내|줘|주고|주자|video|open|give|send|watch)/i.test(t)) return "allowance";
  if (/(녹음|recording)/i.test(t) && /(할 ?일|todo|to-do|투두|정리|뽑|목록|task|action item|extract|list)/i.test(t)) return "todos";
  if (/(앨범|album)/i.test(t) && /(정리|만들|모아|묶|make|create|organi[sz]e|put together|build|sort)/i.test(t)) return "album";
  if (/(장보기|장 볼|재료|shopping list|grocery|ingredients)/i.test(t) && /(목록|리스트|만들|정리|알려|list|make|what)/i.test(t)) return "shopping";
  if (/\d+\s*(인분|servings?|people)/i.test(t) && /(만들|목록|장보기|알려|make|list|shop|cook)/i.test(t)) return "shopping";
  return null;
}

/** The language to answer in: the one the request was written in. */
export function langOf(text: string): "ko" | "en" {
  return /[가-힣]/.test(text) ? "ko" : "en";
}

/** Names the family's data uses, as someone asking in English might say them. */
const ALIASES: Record<string, string[]> = {
  녹두전: ["nokdujeon", "mung bean pancake", "mung-bean pancake", "bindaetteok"],
  송편: ["songpyeon", "rice cake"],
  토란국: ["toranguk", "taro soup"],
  식혜: ["sikhye", "rice punch"],
  된장찌개: ["doenjang", "soybean paste stew"],
  배추김치: ["kimchi"],
  제주: ["jeju"],
  서연: ["seoyeon", "seo-yeon"],
  할머니: ["grandma", "grandmother"],
};
const mentions = (text: string, word: string) =>
  text.includes(word) || (ALIASES[word] ?? []).some((a) => text.toLowerCase().includes(a));

export interface SkillContext {
  workspaceId: string;
  askerId: string;
  sources: DriveSource[];
  text: string;
  /** answer (and write the page) in this language */
  lang: "ko" | "en";
  /** whose phones did not answer while listing (filled by listAll) */
  offline?: string[];
}

const tr = (ctx: SkillContext, ko: string, en: string) => (ctx.lang === "en" ? en : ko);
/** How the family is called in English. */
const NAME_EN: Record<string, string> = { 할머니: "Grandma", 엄마: "Mom", 아빠: "Dad", 서연: "Seoyeon", 도윤: "Doyun", 모두: "Everyone" };
const nm = (ctx: SkillContext, name: string) => (ctx.lang === "en" ? (NAME_EN[name] ?? name) : name);
const outLang = (ctx: SkillContext) => (ctx.lang === "en" ? "English" : "Korean");

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

async function listAll(ctx: SkillContext): Promise<Found[]> {
  const out: Found[] = [];
  const off = new Set<string>();
  await Promise.all(
    ctx.sources.map(async (src) => {
      const files = await runAsOrService(src.linkedBy, () => listTree(src.link, 400, 80, notUserFolder)).catch(() => {
        // a phone that is off answers nothing — say so rather than quietly leave it out
        off.add(src.ownerName ?? src.label);
        return [] as string[];
      });
      for (const rel of files)
        if (!/(^|\/)ainmem-|(^|\/)\.aindrive\//.test(rel)) out.push({ src, rel, full: [src.link.root, rel].filter(Boolean).join("/") });
    })
  );
  ctx.offline = [...off];
  return out;
}

/** "아빠 폰이 꺼져 있어…" — appended to an answer when a phone did not answer. */
function offNote(ctx: SkillContext): string {
  const off = ctx.offline ?? [];
  if (!off.length) return "";
  return ctx.lang === "en"
    ? `\n⚠️ ${off.map((o) => nm(ctx, o)).join(", ")}'s phone${off.length > 1 ? "s are" : " is"} off, so nothing from ${off.length > 1 ? "them" : "it"} is included — ask again once ${off.length > 1 ? "they're" : "it's"} on.`
    : `\n⚠️ ${off.join(", ")} 폰이 꺼져 있어서 그 폰의 파일은 못 읽었어요. 켜지면 다시 부탁해 주세요.`;
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
  const files = await listAll(ctx);
  const recipes = files.filter((f) => /(^|\/)레시피\//.test(f.full) && /\.md$/i.test(f.rel) && !/계량/.test(f.rel));
  const dishOf = (f: Found) => nameOf(f.rel).replace(/\.md$/i, "");
  const recipe = recipes.find((f) => mentions(ctx.text, dishOf(f)));
  if (!recipe)
    return {
      text: recipes.length
        ? tr(ctx, `어떤 음식인지 알려 주세요. 가족이 공유한 레시피: `, `Which dish? Recipes the family shared: `) + recipes.map(dishOf).join(", ")
        : tr(ctx, "가족이 공유한 폴더에서 레시피를 찾지 못했어요.", "I couldn't find a recipe in the folders the family shared."),
    };
  const dish = dishOf(recipe);
  const servings = Number(ctx.text.match(/(\d+)\s*(인분|servings?|people)/i)?.[1] ?? 4);
  const measure = files.find((f) => f.src === recipe.src && /계량/.test(f.rel));
  const [recipeText, measureText] = await Promise.all([read(recipe), measure ? read(measure) : Promise.resolve("")]);
  const plan = await llmJson<{ originalServings?: number; items?: { name: string; amount: string; note?: string }[]; steps?: string[] }>(
    "You turn a Korean family recipe into a shopping list for a different number of servings. Use the household measure table when given " +
      '("한 줌" → grams). Output JSON only: {"originalServings":<number the recipe makes>,"items":[{"name":"<재료>","amount":"<scaled amount, Korean units or grams>","note":"<short tip or empty>"}],' +
      '"steps":["<short step>", …3 to 6]}. Keep every ingredient; do not invent any. ' +
      `Write names, amounts, notes and steps in ${outLang(ctx)}.`,
    `## Recipe\n${recipeText.slice(0, 5000)}\n\n## Household measures\n${measureText.slice(0, 2000)}\n\n## Servings wanted\n${servings}`
  );
  if (!plan?.items?.length)
    return { text: tr(ctx, `${dish} 레시피를 읽었는데 재료를 정리하지 못했어요. 한 번 더 말해 주세요.`, `I read the ${dish} recipe but couldn't list the ingredients. Ask me once more?`) };
  const media = files.filter((f) => f.src === recipe.src && f !== recipe && nameOf(f.rel).includes(dish));
  const review = files.find((f) => /후기/.test(f.rel) && nameOf(f.rel).includes(dish));
  const ts = await teamspaceOf(recipe, ctx.workspaceId);
  if (!ts) return { text: tr(ctx, "레시피가 있는 팀스페이스를 찾지 못했어요.", "I couldn't find the teamspace the recipe is in.") };
  const title = tr(ctx, `${dish} ${servings}인분 장보기`, `${dish} for ${servings} — shopping list`);
  const body: NewBlock[] = [
    b.callout(
      "🛒",
      tr(
        ctx,
        `${who(recipe)}의 ${dish} 레시피(${plan.originalServings ?? "?"}인분 기준)를 ${servings}인분으로 맞췄어요.` +
          (measure ? " 「한 줌」 같은 단위는 할머니 계량법으로 바꿨어요." : ""),
        `${nm(ctx, who(recipe))}'s ${dish} recipe (makes ${plan.originalServings ?? "?"}) scaled to ${servings} servings.` +
          (measure ? ` Measures like "a handful" are converted with grandma's measure table.` : "")
      )
    ),
    b.h2(tr(ctx, "장볼 것", "To buy")),
    ...plan.items.map((i) => b.todo(`${i.name} ${i.amount}${i.note ? ` — ${i.note}` : ""}`)),
    b.h2(tr(ctx, "만드는 법 (요약)", "How to make it (short)")),
    ...(plan.steps ?? []).map((s) => b.num(s)),
    b.h2(tr(ctx, `${who(recipe)}의 자료`, `From ${nm(ctx, who(recipe))}'s phone`)),
    b.file(urlOf(recipe), nameOf(recipe.rel)),
    ...media.map((f) => b.file(urlOf(f), nameOf(f.rel))),
    ...(measure ? [b.file(urlOf(measure), nameOf(measure.rel))] : []),
    ...(review ? [b.h2(tr(ctx, "해 본 사람 후기", "Tried it")), b.file(urlOf(review), `${nameOf(review.rel)} — ${who(review)}`)] : []),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "🛒", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      tr(ctx, `${dish} ${servings}인분 장보기 목록을 만들었어요 → /p/${pageId}\n`, `Made the ${dish} shopping list for ${servings} → /p/${pageId}\n`) +
      plan.items.slice(0, 6).map((i) => `- ${i.name} ${i.amount}`).join("\n") +
      (plan.items.length > 6 ? tr(ctx, `\n… 외 ${plan.items.length - 6}가지`, `\n… and ${plan.items.length - 6} more`) : "") +
      tr(ctx, `\n출처: ${who(recipe)} 폰 — `, `\nFrom ${nm(ctx, who(recipe))}'s phone — `) +
      [recipe, ...media].map((m) => nameOf(m.rel)).join(", ") +
      offNote(ctx),
  };
}

// ── 2. 녹음: a recording's transcript → a to-do board ─────────────────────

async function todos(ctx: SkillContext): Promise<SkillResult> {
  const files = await listAll(ctx);
  const audio = files.filter((f) => /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.rel));
  const pairs = audio
    .map((a) => ({ audio: a, text: files.find((t) => t.src === a.src && t.rel === a.rel.replace(/\.[^.]+$/, ".txt")) }))
    .filter((p): p is { audio: Found; text: Found } => !!p.text)
    .sort((x, y) => nameOf(y.audio.rel).localeCompare(nameOf(x.audio.rel)));
  const pick = pairs[0];
  if (!pick)
    return { text: tr(ctx, "공유된 폴더에서 받아쓰기(.txt)가 있는 녹음을 찾지 못했어요.", "I couldn't find a recording with a transcript (.txt) in the shared folders.") };
  const transcript = await read(pick.text);
  const out = await llmJson<{ title?: string; date?: string; tasks?: { task: string; owner: string; due?: string | null; note?: string }[] }>(
    "You read a Korean family meeting transcript and list every action item someone took on. Resolve dates against the meeting date " +
      '(the year is in the header). Output JSON only: {"title":"<short meeting title>","date":"YYYY-MM-DD",' +
      '"tasks":[{"task":"<what, short>","owner":"<who: one person\'s name as spoken, e.g. 엄마/아빠/서연/도윤, or 모두>","due":"YYYY-MM-DD or null","note":"<detail or empty>"}]}. ' +
      `Write title, task and note in ${outLang(ctx)}; keep owner names exactly as spoken.`,
    transcript.slice(0, 6000),
    1500
  );
  if (!out?.tasks?.length) return { text: tr(ctx, "녹음을 읽었는데 할 일을 찾지 못했어요.", "I read the recording but found no to-dos.") };
  const ts = await teamspaceOf(pick.audio, ctx.workspaceId);
  if (!ts) return { text: tr(ctx, "녹음이 있는 팀스페이스를 찾지 못했어요.", "I couldn't find the teamspace the recording is in.") };
  const C = ctx.lang === "en"
    ? { task: "To-do", owner: "Owner", due: "Due", state: "Status", note: "Note", todo: "To do", doing: "Doing", done: "Done", byOwner: "By owner", progress: "Progress", table: "Table", suffix: "to-dos", meeting: "Meeting" }
    : { task: "할 일", owner: "담당", due: "기한", state: "상태", note: "메모", todo: "할 일", doing: "진행 중", done: "완료", byOwner: "담당별", progress: "진행", table: "표", suffix: "할 일", meeting: "회의" };
  const palette = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];
  const owners = [...new Set(out.tasks.map((t) => t.owner).filter(Boolean))];
  const dbId = await createAgentDatabase({
    workspaceId: ctx.workspaceId,
    byUserId: ctx.askerId,
    title: `${out.title ?? C.meeting} — ${C.suffix}`,
    columns: [
      { name: C.task, type: "title" },
      { name: C.owner, type: "select", options: owners.map((o, i) => ({ name: o, color: palette[i % palette.length] })) },
      { name: C.due, type: "date" },
      { name: C.state, type: "select", options: [{ name: C.todo, color: "gray" }, { name: C.doing, color: "blue" }, { name: C.done, color: "green" }] },
      { name: C.note, type: "text" },
    ],
    rows: out.tasks.map((t) => ({ [C.task]: t.task, [C.owner]: t.owner, [C.due]: t.due ?? null, [C.state]: C.todo, [C.note]: t.note ?? "" })),
    views: [
      { name: C.byOwner, type: "board", groupBy: C.owner, hide: [C.owner] },
      { name: C.progress, type: "board", groupBy: C.state, hide: [C.state] },
      { name: C.due, type: "calendar", date: C.due },
      { name: C.table, type: "table" },
    ],
  });
  const title = `${out.title ?? C.meeting} — ${C.suffix}`;
  const body: NewBlock[] = [
    b.callout(
      "🎙️",
      tr(
        ctx,
        `${who(pick.audio)} 폰의 녹음(${nameOf(pick.audio.rel)})에서 뽑은 할 일 ${out.tasks.length}개예요.` +
          (ts.private ? ` 🤫 이 팀스페이스(${ts.name})에만 있어요 — 멤버가 아닌 가족에게는 보이지 않아요.` : ""),
        `${out.tasks.length} to-dos from the recording on ${nm(ctx, who(pick.audio))}'s phone (${nameOf(pick.audio.rel)}).` +
          (ts.private ? ` 🤫 Only in this teamspace (${ts.name}) — family members outside it can't see it.` : "")
      )
    ),
    b.database(dbId),
    b.h2(tr(ctx, "녹음", "Recording")),
    b.file(urlOf(pick.audio), nameOf(pick.audio.rel)),
    b.file(urlOf(pick.text), nameOf(pick.text.rel)),
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "✅", byUserId: ctx.askerId, blocks: body });
  return {
    pageId,
    text:
      tr(ctx, `녹음에서 할 일 ${out.tasks.length}개를 뽑아 보드로 만들었어요 → /p/${pageId}\n`, `Pulled ${out.tasks.length} to-dos from the recording into a board → /p/${pageId}\n`) +
      out.tasks.map((t) => `- ${nm(ctx, t.owner)}: ${t.task}${t.due ? ` (~${t.due.slice(5).replace("-", "/")})` : ""}`).join("\n") +
      offNote(ctx),
  };
}

// ── 3. 앨범: photos from every phone, by day, duplicates once ──────────────

const REGIONS: Record<string, [number, number, number, number]> = {
  제주: [33.0, 33.7, 126.0, 127.1],
};
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REGION_EN: Record<string, string> = { 제주: "Jeju" };

async function album(ctx: SkillContext): Promise<SkillResult> {
  const files = await listAll(ctx);
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
  const asked = Object.keys(REGIONS).find((r) => mentions(ctx.text, r));
  // "외할아버지 사진으로 앨범" — one person's phone; the longest name wins
  // (외할아버지 over 할아버지)
  const owners = [...new Set(shots.map((x) => who(x.f)))].sort((a, b2) => b2.length - a.length);
  const person = owners.find((o) => mentions(ctx.text, o));
  let pick = asked ? shots.filter((s) => inRegion(asked, s.ex)) : shots;
  if (person) pick = pick.filter((s) => who(s.f) === person);
  if (!asked && !person) {
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
  if (!pick.length)
    return {
      text: tr(
        ctx,
        `공유된 폴더에서 ${asked ? `${asked}에서 ` : ""}찍은 사진(촬영 정보 있는)을 찾지 못했어요.`,
        `I couldn't find photos${asked ? ` taken in ${REGION_EN[asked] ?? asked}` : ""} (with date/location info) in the shared folders.`
      ),
    };
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
  if (!ts) return { text: tr(ctx, "사진이 있는 팀스페이스를 찾지 못했어요.", "I couldn't find the teamspace the photos are in.") };
  const regionName = region ? tr(ctx, region, REGION_EN[region] ?? region) : "";
  const place = (f: Found) => nameOf(f.rel).replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const body: NewBlock[] = [
    b.callout(
      "📸",
      tr(
        ctx,
        `${phones.join(" · ")}의 폰에서 ${region ? `${region} ` : ""}사진 ${pick.length}장을 찍은 시각·위치로 모아 날짜별로 정리했어요.` +
          (dupes.length ? ` 같은 사진 ${dupes.length}장(서로 주고받은 것)은 한 번만 넣었어요.` : "") +
          " 할머니, 보시고 댓글 남겨 주세요!",
        `${pick.length} ${regionName ? `${regionName} ` : ""}photos from ${phones.map((x) => nm(ctx, x)).join(" · ")}'s phones, gathered by when and where they were taken and sorted by day.` +
          (dupes.length ? ` ${dupes.length} duplicate${dupes.length > 1 ? "s" : ""} (sent between phones) included once.` : "") +
          " Grandma, leave a comment!"
      )
    ),
    ...days.flatMap((d, i) => {
      const dt = new Date(`${d}T00:00:00`);
      const daily = pick.filter((s) => s.ex.takenAt!.startsWith(d));
      return [
        b.h2(
          tr(
            ctx,
            `${i + 1}일차 · ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WEEKDAY[dt.getDay()]})`,
            `Day ${i + 1} · ${WEEKDAY_EN[dt.getDay()]}, ${MONTH_EN[dt.getMonth()]} ${dt.getDate()}`
          )
        ),
        ...daily.map((s) =>
          b.file(
            urlOf(s.f),
            `${s.ex.takenAt!.slice(11, 16)} · ${place(s.f)} — ${tr(ctx, `${who(s.f)} 폰`, `${nm(ctx, who(s.f))}'s phone`)}${s.ex.model ? ` (${s.ex.model})` : ""}`
          )
        ),
      ];
    }),
    ...(docs.length ? [b.h2(tr(ctx, "여행 계획과 경비", "Trip plan and budget")), ...docs.map((f) => b.file(urlOf(f), `${nameOf(f.rel)} — ${who(f)}`))] : []),
  ];
  const title = person
    ? tr(ctx, `${person}의 사진 앨범`, `${nm(ctx, person)}'s photo album`)
    : tr(ctx, `${region ?? "가족"} 여행 앨범`, `${regionName || "Family"} trip album`);
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "📸", byUserId: ctx.askerId, blocks: body, fullWidth: true });
  return {
    pageId,
    text:
      tr(ctx, `${title}을 만들었어요 → /p/${pageId}\n`, `Made the ${title} → /p/${pageId}\n`) +
      tr(
        ctx,
        `${phones.join(" · ")} 폰의 사진 ${pick.length}장, ${days.length}일로 나눴어요` + (dupes.length ? ` (겹친 사진 ${dupes.length}장은 뺐어요)` : ""),
        `${pick.length} photos from ${phones.map((x) => nm(ctx, x)).join(" · ")}'s phones, over ${days.length} days` + (dupes.length ? ` (${dupes.length} duplicate left out)` : "")
      ) +
      ".\n" +
      days
        .map((d, i) => `- ${tr(ctx, `${i + 1}일차`, `Day ${i + 1}`)} ${d.slice(5).replace("-", "/")}: ${pick.filter((s) => s.ex.takenAt!.startsWith(d)).map((s) => place(s.f)).join(", ")}`)
        .join("\n") +
      offNote(ctx),
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
  const named = gifts.filter((g) => mentions(ctx.text, g.gift.spec.recipientName.replace(/이$/, "")));
  const target = named[0] ?? (gifts.length === 1 ? gifts[0] : undefined);
  if (!target)
    return {
      text: gifts.length
        ? tr(ctx, "누구 영상을 열까요? ", "Whose video should I open? ") + gifts.map((g) => `${g.gift.spec.recipientName} — 「${g.gift.spec.title}」`).join(", ")
        : tr(ctx, "용돈으로 여는 선물 영상이 아직 없어요.", "There's no pocket-money gift video yet."),
    };
  const { spec } = target.gift;
  if (spec.recipientUserId === ctx.askerId) return { text: tr(ctx, "자기 영상은 용돈 없이 볼 수 있어요 🙂", "You can watch your own video without paying 🙂") };
  if (unlocked(target.gift))
    return { pageId: target.pageId, text: tr(ctx, `「${spec.title}」은 이미 열렸어요 → /p/${target.pageId}`, `「${spec.title}」 is already open → /p/${target.pageId}`) };
  const r = await payGift(ctx.askerId, spec.id);
  if (!r.ok) return { text: tr(ctx, `용돈을 보내지 못했어요: ${r.error}`, `Couldn't send the pocket money: ${r.error}`) };
  const payerDrive = await ledgerDriveOf(ctx.askerId);
  const left = payerDrive ? await ledgerBalance(ctx.askerId, payerDrive) : null;
  const [asker] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, ctx.askerId));
  return {
    pageId: target.pageId,
    text: tr(
      ctx,
      `🎁 ${spec.recipientName}에게 용돈 ${spec.amountKrw.toLocaleString("ko-KR")}원(${formatUsdc(spec.amount)} USDC)을 보냈어요. ` +
        `x402로 결제했고 「${spec.title}」이 열렸어요 → /p/${target.pageId}\n` +
        `영수증 ${r.receipt}` +
        (left !== null ? ` · ${asker?.name ?? ""} 용돈 장부 잔액 ${left.toLocaleString("ko-KR")}원` : "") +
        ` (장부는 각자의 aindrive 「지갑/」 폴더에 적혔어요)`,
      `🎁 Sent ${nm(ctx, spec.recipientName)} ₩${spec.amountKrw.toLocaleString("en-US")} of pocket money (${formatUsdc(spec.amount)} USDC). ` +
        `Paid over x402 — 「${spec.title}」 is open → /p/${target.pageId}\n` +
        `Receipt ${r.receipt}` +
        (left !== null ? ` · ${nm(ctx, asker?.name ?? "")}'s pocket-money ledger: ₩${left.toLocaleString("en-US")} left` : "") +
        ` (both ledgers are in each person's aindrive 「지갑/」 folder)`
    ),
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
