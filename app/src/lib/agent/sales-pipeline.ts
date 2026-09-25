import "server-only";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocks,
  databases,
  dbProperties,
  dbRows,
  dbViews,
  pages,
  teamspaceDrives,
  teamspaces,
  users,
  type BlockContent,
  type BlockType,
  type DbProperty,
} from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { runAsOrService } from "@/lib/aindrive-account";
import { aindrivePublicBase, listTree, notUserFolder, parseLink, readFile, type AindriveLink } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { visibleTeamspace } from "@/lib/aindrive-teamspace";

/**
 * "통합 sales pipeline 만들어줘": the agent's one skill that builds rather than
 * answers.
 *
 * Every salesperson's phone syncs its call history into their own aindrive
 * folder, one markdown file per call, and each of them has linked that folder
 * into a teamspace. This reads every call from every linked folder the asker
 * can see (each drive as the person who linked it), has the model pull the
 * sales facts out of each call one at a time — a call fits the local model's
 * context, a quarter's worth does not — and merges them per customer into one
 * database: the latest call decides the stage, whoever called is on the deal.
 *
 * Asking again rebuilds the same page, so the pipeline is always the calls as
 * they are now.
 */

export const PIPELINE_TITLE = "통합 Sales Pipeline";

const STAGES = [
  { name: "리드", color: "gray" },
  { name: "니즈 파악", color: "blue" },
  { name: "제안", color: "purple" },
  { name: "협상", color: "orange" },
  { name: "계약 완료", color: "green" },
  { name: "보류", color: "red" },
] as const;
type Stage = (typeof STAGES)[number]["name"];
const OPEN: Stage[] = ["리드", "니즈 파악", "제안", "협상"];

/** Asked to build (or refresh) the pipeline. */
export function asksForPipeline(text: string): boolean {
  return /(파이프\s*라인|pipeline)/i.test(text) && /(만들|생성|정리|업데이트|갱신|새로|build|create|make|update|refresh)/i.test(text);
}

interface CallFile {
  drive: { name: string; link: AindriveLink; linkedBy: string | null };
  path: string;
  text: string;
}

interface CallFacts {
  sales: boolean;
  company: string;
  contact: string;
  stage: Stage;
  amount: number | null;
  product: string;
  nextAction: string;
  nextActionDate: string | null;
  summary: string;
  date: string; // YYYY-MM-DD
  file: CallFile;
}

export interface PipelineResult {
  pageId: string | null;
  text: string;
}

const CALL_FILES_MAX = 200;
const CALL_CHARS = 6_000;
const EXTRACT_CONCURRENCY = 4;

/** A call record: a markdown file under a call folder or named for one. Not
 *  the teamspace's own OKF backup (ainmem-<teamspace>-…/), which can land in
 *  the same drive and would feed the pipeline its own previous output. */
function looksLikeCall(path: string): boolean {
  return /\.md$/i.test(path) && /(통화|call)/i.test(path) && !/readme\.md$/i.test(path) && !/(^|\/)ainmem-/.test(path);
}

/** `key: value` lines of a leading --- block. */
function frontMatter(text: string): Record<string, string> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split(/\r?\n/) ?? []) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function callDate(file: CallFile): string {
  const fm = frontMatter(file.text);
  const from = fm["시작"] ?? fm["date"] ?? fm["started"] ?? file.path.split("/").pop() ?? "";
  return from.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

function asStage(v: unknown): Stage {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return (STAGES.find((x) => x.name === s)?.name ?? (/계약|성사|won/i.test(s) ? "계약 완료" : /보류|연기|실패|lost/i.test(s) ? "보류" : "리드")) as Stage;
}

function asDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function asText(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** One call → its sales facts, or null when it is not a sales call. */
async function extract(file: CallFile): Promise<CallFacts | null> {
  const date = callDate(file);
  const fm = frontMatter(file.text);
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          "You read one phone call record from a salesperson's phone and pull out the sales facts. " +
          `The call happened on ${date || "an unknown date"}; resolve relative dates ("다음 주 화요일", "10월 2일") against it, in YYYY-MM-DD.\n` +
          "Output JSON only:\n" +
          '{"sales":true,"company":"<the customer company, short name, e.g. 대한물산>","contact":"<customer person and role>",' +
          `"stage":"<one of: ${STAGES.map((s) => s.name).join(" | ")}>","amount":<the latest amount in KRW as an integer (1억 800만 원 → 108000000), or null>,` +
          '"product":"<what is being sold, short>","nextAction":"<the next step agreed, short Korean>","nextActionDate":"<YYYY-MM-DD or null>","summary":"<one short Korean sentence>"}\n' +
          'A personal or non-sales call (family, a dentist, a delivery) → {"sales":false}.\n' +
          "Stage guide: 리드 = first contact or interest only; 니즈 파악 = needs/budget being discussed, a demo or visit being set up; " +
          "제안 = a proposal or quote has been sent/explained; 협상 = price or terms being negotiated; 계약 완료 = signed or confirmed; 보류 = postponed or lost.",
      },
      { role: "user", content: file.text.slice(0, CALL_CHARS) },
    ],
    { maxTokens: 400, temperature: 0 }
  ).catch((e) => {
    console.error("[sales-pipeline] extract failed:", file.path, (e as Error).message);
    return "";
  });
  let j: Record<string, unknown> = {};
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    j = JSON.parse((fenced ? fenced[1] : raw).trim().replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
  } catch {
    j = {};
  }
  if (j.sales === false) return null;
  // the model said nothing usable: the front matter still names who was called
  const org = fm["소속"] ?? fm["company"] ?? "";
  const company = asText(j.company, 60) || org.split(/\s+/)[0] || "";
  if (!company) return null;
  const amount = typeof j.amount === "number" && Number.isFinite(j.amount) && j.amount > 0 ? Math.round(j.amount) : null;
  return {
    sales: true,
    company,
    contact: asText(j.contact, 80) || [fm["상대"], org].filter(Boolean).join(" · "),
    stage: asStage(j.stage),
    amount,
    product: asText(j.product, 80),
    nextAction: asText(j.nextAction),
    nextActionDate: asDate(j.nextActionDate),
    summary: asText(j.summary, 300),
    date,
    file,
  };
}

const norm = (s: string) => s.replace(/\s+|\(주\)|㈜|주식회사/g, "").toLowerCase();

interface Deal {
  company: string;
  stage: Stage;
  amount: number | null;
  owners: string[]; // user ids
  contact: string;
  product: string;
  lastCall: string;
  nextAction: string;
  nextActionDate: string | null;
  summary: string;
  calls: CallFacts[];
}

function mergeDeals(facts: CallFacts[]): Deal[] {
  const by = new Map<string, CallFacts[]>();
  for (const f of facts) {
    const k = norm(f.company);
    by.set(k, [...(by.get(k) ?? []), f]);
  }
  const deals: Deal[] = [];
  for (const calls of by.values()) {
    calls.sort((a, b) => a.date.localeCompare(b.date) || a.file.path.localeCompare(b.file.path));
    const last = calls[calls.length - 1];
    const latest = <K extends keyof CallFacts>(k: K) =>
      [...calls].reverse().map((c) => c[k]).find((v) => v !== null && v !== "") ?? null;
    deals.push({
      company: calls[0].company,
      stage: last.stage,
      amount: (latest("amount") as number | null) ?? null,
      owners: [...new Set(calls.map((c) => c.file.drive.linkedBy).filter((x): x is string => !!x))],
      contact: last.contact,
      product: (latest("product") as string | null) ?? "",
      lastCall: last.date,
      nextAction: last.nextAction,
      nextActionDate: last.nextActionDate,
      summary: last.summary,
      calls,
    });
  }
  // closest to closing first; what is on hold goes last
  const order = (s: Stage) => (s === "보류" ? -1 : STAGES.findIndex((x) => x.name === s));
  return deals.sort((a, b) => order(b.stage) - order(a.stage) || (b.amount ?? 0) - (a.amount ?? 0));
}

const won = (n: number) =>
  n >= 100_000_000
    ? `${(n / 100_000_000).toFixed(n % 100_000_000 ? 2 : 0).replace(/\.?0+$/, "")}억 원`
    : `${Math.round(n / 10_000).toLocaleString("ko-KR")}만 원`;

/** The call files of every drive linked into the teamspaces that everyone
 *  who will read the answer can see — a private teamspace's calls must not
 *  surface in a room where someone outside it reads the reply. */
async function gatherCalls(workspaceId: string, viewerIds: string[]) {
  const tss = await db.select().from(teamspaces).where(eq(teamspaces.workspaceId, workspaceId));
  const seenByAll = async (id: string) => {
    for (const v of viewerIds) if (!(await visibleTeamspace(v, id))) return null;
    return tss.find((t) => t.id === id)!;
  };
  const visible = (await Promise.all(tss.map((t) => seenByAll(t.id)))).filter((t) => t !== null);
  if (!visible.length) return { teamspaceId: null as string | null, drives: [], files: [] as CallFile[], failed: [] as string[] };
  const links = await db
    .select()
    .from(teamspaceDrives)
    .where(inArray(teamspaceDrives.teamspaceId, visible.map((t) => t.id)))
    .orderBy(asc(teamspaceDrives.createdAt));
  const files: CallFile[] = [];
  const failed: string[] = [];
  const drives: CallFile["drive"][] = [];
  for (const l of links) {
    let link: AindriveLink | null = null;
    try {
      link = parseLink({ driveId: l.driveId, root: l.root });
    } catch {
      link = null;
    }
    if (!link) continue;
    const drive = { name: l.name, link, linkedBy: l.createdBy };
    try {
      const paths = (await runAsOrService(l.createdBy, () => listTree(link, 500, 60, notUserFolder))).filter(looksLikeCall);
      const read = await inBatches(paths.slice(0, CALL_FILES_MAX), 6, async (p) => ({
        drive,
        path: p,
        text: await runAsOrService(l.createdBy, () => readFile(link, p)),
      }));
      if (read.length) drives.push(drive);
      files.push(...read);
    } catch (e) {
      console.error("[sales-pipeline] drive failed:", l.name, (e as Error).message);
      failed.push(l.name);
    }
  }
  // the pipeline lives with the calls: the first teamspace one of them came from
  const home = links.find((l) => files.some((f) => f.drive.link.driveId === l.driveId))?.teamspaceId ?? visible[0].id;
  return { teamspaceId: home, drives, files, failed };
}

type NewBlock = { type: BlockType; content: BlockContent; children?: NewBlock[] };

/** Writes the pipeline page (replacing the one built before, same page). */
async function writePage(
  workspaceId: string,
  teamspaceId: string,
  askerId: string,
  deals: Deal[],
  facts: CallFacts[],
  calls: number,
  drives: CallFile["drive"][]
) {
  const names = new Map(
    (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [...new Set(drives.map((d) => d.linkedBy).filter((x): x is string => !!x))].concat(askerId))))
      .map((u) => [u.id, u.name])
  );

  const [database] = await db.insert(databases).values({ workspaceId, title: PIPELINE_TITLE, createdBy: askerId }).returning();
  const stageOptions = STAGES.map((s) => ({ id: crypto.randomUUID(), name: s.name, color: s.color }));
  const defs: { name: string; type: DbProperty["type"]; config?: DbProperty["config"] }[] = [
    { name: "거래처", type: "title" },
    { name: "단계", type: "select", config: { options: stageOptions } },
    { name: "예상 금액", type: "number", config: { numberFormat: "comma" } },
    { name: "담당", type: "person" },
    { name: "고객 담당자", type: "text" },
    { name: "제품", type: "text" },
    { name: "다음 액션", type: "text" },
    { name: "기한", type: "date" },
    { name: "마지막 통화", type: "date" },
    { name: "통화 수", type: "number" },
    { name: "요약", type: "text" },
  ];
  const props = await db
    .insert(dbProperties)
    .values(defs.map((d, i) => ({ databaseId: database.id, name: d.name, type: d.type, config: d.config ?? {}, position: i + 1 })))
    .returning();
  const P = (name: string) => props.find((p) => p.name === name)!.id;
  if (deals.length)
    await db.insert(dbRows).values(
      deals.map((d, i) => ({
        databaseId: database.id,
        position: i + 1,
        createdBy: askerId,
        updatedBy: askerId,
        values: {
          [P("거래처")]: d.company,
          [P("단계")]: stageOptions.find((o) => o.name === d.stage)!.id,
          [P("예상 금액")]: d.amount,
          [P("담당")]: d.owners,
          [P("고객 담당자")]: d.contact,
          [P("제품")]: d.product,
          [P("다음 액션")]: d.nextAction,
          [P("기한")]: d.nextActionDate ? { start: d.nextActionDate } : null,
          [P("마지막 통화")]: d.lastCall ? { start: d.lastCall } : null,
          [P("통화 수")]: d.calls.length,
          [P("요약")]: d.summary,
        },
      }))
    );
  await db.insert(dbViews).values([
    {
      databaseId: database.id,
      name: "단계별 보드",
      type: "board" as const,
      // a card is who, how much and what next — the rest is one click away
      config: {
        groupByPropertyId: P("단계"),
        hiddenProperties: ["단계", "고객 담당자", "제품", "마지막 통화", "통화 수", "요약"].map(P),
      },
      position: 1,
    },
    {
      databaseId: database.id,
      name: "전체 표",
      type: "table" as const,
      config: { calcs: { [P("예상 금액")]: "sum", [P("통화 수")]: "sum" } },
      position: 2,
    },
    { databaseId: database.id, name: "기한 달력", type: "calendar" as const, config: { calendarDatePropertyId: P("기한") }, position: 3 },
    {
      databaseId: database.id,
      name: "대시보드",
      type: "dashboard" as const,
      config: {
        widgets: [
          { id: crypto.randomUUID(), kind: "counter", title: "거래처", width: 1, aggregate: "count" },
          { id: crypto.randomUUID(), kind: "counter", title: "예상 금액 합계", width: 1, aggregate: "sum", aggregatePropertyId: P("예상 금액") },
          { id: crypto.randomUUID(), kind: "bar", title: "단계별 거래처", width: 2, groupByPropertyId: P("단계"), aggregate: "count" },
          { id: crypto.randomUUID(), kind: "donut", title: "단계별 금액", width: 2, groupByPropertyId: P("단계"), aggregate: "sum", aggregatePropertyId: P("예상 금액") },
          { id: crypto.randomUUID(), kind: "board", title: "보드", width: 2, groupByPropertyId: P("단계") },
        ],
      },
      position: 4,
    },
  ]);

  const open = deals.filter((d) => OPEN.includes(d.stage));
  const openSum = open.reduce((s, d) => s + (d.amount ?? 0), 0);
  const wonSum = deals.filter((d) => d.stage === "계약 완료").reduce((s, d) => s + (d.amount ?? 0), 0);
  const who = drives.map((d) => `${names.get(d.linkedBy ?? "") ?? d.name}`).join(" · ");
  const base = aindrivePublicBase();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = deals
    .filter((d) => d.nextActionDate && d.nextActionDate >= today && d.stage !== "보류")
    .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""));

  const body: NewBlock[] = [
    {
      type: "callout",
      content: {
        icon: "📞",
        text:
          `${who}의 폰이 aindrive에 올린 통화기록 ${calls}건을 읽어, 영업 통화 ${facts.length}건을 거래처 ${deals.length}곳으로 묶었어요. ` +
          `진행 중 ${open.length}건 ${won(openSum)}, 계약 완료 ${won(wonSum)}. ` +
          `같은 거래처를 여러 사람이 통화했으면 한 줄로 합치고, 가장 최근 통화가 단계를 정합니다.`,
      },
    },
    { type: "database", content: { databaseId: database.id } },
    { type: "heading2", content: { text: "다가오는 일정" } },
    ...(upcoming.length
      ? upcoming.map((d) => ({
          type: "todo" as const,
          content: { text: `${d.nextActionDate} · ${d.company} — ${d.nextAction} (${d.owners.map((o) => names.get(o) ?? "").join(", ")})`, checked: false },
        }))
      : [{ type: "paragraph" as const, content: { text: "잡혀 있는 다음 일정이 없어요." } }]),
    { type: "heading2", content: { text: "근거 통화기록" } },
    { type: "paragraph", content: { text: "모든 줄은 아래 통화에서 나왔어요. 파일은 각자의 aindrive에 그대로 있고, 여기에는 링크만 걸려 있습니다." } },
    ...deals.map((d) => ({
      type: "toggle" as const,
      content: { text: `${d.company} — ${d.stage}${d.amount ? ` · ${won(d.amount)}` : ""} · 통화 ${d.calls.length}건`, expanded: false },
      children: d.calls.map((c) => ({
        type: "file" as const,
        content: {
          url: base ? aindriveFileUrl(base, { driveId: c.file.drive.link.driveId, path: [c.file.drive.link.root, c.file.path].filter(Boolean).join("/") }) : "",
          text: `${c.date} · ${names.get(c.file.drive.linkedBy ?? "") ?? c.file.drive.name} — ${c.file.path.split("/").pop()}`,
        },
      })),
    })),
  ];

  // same page as last time, when there is one — the link in the chat keeps working
  const [prev] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.teamspaceId, teamspaceId), eq(pages.title, PIPELINE_TITLE), eq(pages.isArchived, false)));
  let pageId: string;
  if (prev) {
    pageId = prev.id;
    const old = await db.select({ content: blocks.content }).from(blocks).where(and(eq(blocks.pageId, pageId), eq(blocks.type, "database")));
    await db.delete(blocks).where(eq(blocks.pageId, pageId));
    const oldDbs = old.map((b) => b.content.databaseId).filter((x): x is string => typeof x === "string");
    if (oldDbs.length) await db.delete(databases).where(inArray(databases.id, oldDbs));
    await db.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
  } else {
    const [{ top }] = await db.select({ top: max(pages.position) }).from(pages).where(eq(pages.teamspaceId, teamspaceId));
    const [pg] = await db
      .insert(pages)
      .values({ workspaceId, teamspaceId, title: PIPELINE_TITLE, icon: "📈", fullWidth: true, position: (top ?? 0) + 1, createdBy: askerId })
      .returning();
    pageId = pg.id;
  }
  let pos = 0;
  for (const b of body) {
    const [row] = await db.insert(blocks).values({ pageId, type: b.type, content: b.content, position: ++pos }).returning();
    if (b.children?.length)
      await db.insert(blocks).values(b.children.map((c, i) => ({ pageId, parentBlockId: row.id, type: c.type, content: c.content, position: i + 1 })));
  }
  return { pageId, open, openSum, wonSum, upcoming };
}

/** Builds the pipeline for `askerId` from the calls in this workspace's linked
 *  folders, drawing only on teamspaces every one of `viewerIds` (who will read
 *  the answer; the asker among them) can see. `progress` gets one line once the
 *  calls are found. */
export async function buildSalesPipeline(
  workspaceId: string | null,
  askerId: string,
  viewerIds: string[],
  progress?: (line: string) => Promise<void>
): Promise<PipelineResult> {
  if (!workspaceId) return { pageId: null, text: "이 대화방은 워크스페이스에 속해 있지 않아서 연동된 aindrive를 찾을 수 없어요." };
  const { teamspaceId, drives, files, failed } = await gatherCalls(workspaceId, [...new Set([askerId, ...viewerIds])]);
  if (!teamspaceId || !files.length)
    return {
      pageId: null,
      text:
        "연동된 aindrive에서 통화기록을 찾지 못했어요. 팀스페이스에 각자의 폰 통화기록 폴더(aindrive)를 연결하면 거기서 모아 파이프라인을 만들게요." +
        (failed.length ? ` (열지 못한 폴더: ${failed.join(", ")})` : ""),
    };
  await progress?.(`aindrive ${drives.length}곳(${drives.map((d) => d.name).join(", ")})에서 통화기록 ${files.length}건을 찾았어요. 한 건씩 읽고 거래처별로 정리하는 중…`);
  const facts = (await inBatches(files, EXTRACT_CONCURRENCY, extract)).filter((f): f is CallFacts => f !== null);
  const deals = mergeDeals(facts);
  const { pageId, open, openSum, wonSum, upcoming } = await writePage(workspaceId, teamspaceId, askerId, deals, facts, files.length, drives);
  const skipped = files.length - facts.length;
  const lines = [
    `통합 Sales Pipeline을 만들었어요 → /p/${pageId}`,
    `통화 ${files.length}건 → 거래처 ${deals.length}곳${skipped ? ` (영업과 무관한 통화 ${skipped}건은 뺐어요)` : ""}.`,
    `진행 중 ${open.length}건 ${won(openSum)} · 계약 완료 ${won(wonSum)}`,
    ...STAGES.map((s) => {
      const ds = deals.filter((d) => d.stage === s.name);
      return ds.length ? `- ${s.name}: ${ds.map((d) => `${d.company}${d.amount ? `(${won(d.amount)})` : ""}`).join(", ")}` : "";
    }).filter(Boolean),
    ...(upcoming.length ? [`가장 가까운 일정: ${upcoming[0].nextActionDate} ${upcoming[0].company} — ${upcoming[0].nextAction}`] : []),
    ...(failed.length ? [`(열지 못한 폴더: ${failed.join(", ")})`] : []),
  ];
  return { pageId, text: lines.join("\n") };
}
