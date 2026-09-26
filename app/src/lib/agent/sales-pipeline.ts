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
import { SALES, anyOf } from "@/i18n/content/agent";
import { makeT } from "@/i18n/translate";

/** The sales demo answers (and writes its page) in Korean. */
const t = makeT("ko");

/**
 * "Build the integrated sales pipeline" (SALES_PIPELINE_EXAMPLE in @/i18n/content/agent):
 * the agent's one skill that builds rather than
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

export const PIPELINE_TITLE = SALES.title;

const ST = SALES.stages;
const STAGES = [
  { name: ST.lead, color: "gray" },
  { name: ST.discovery, color: "blue" },
  { name: ST.proposal, color: "purple" },
  { name: ST.negotiation, color: "orange" },
  { name: ST.won, color: "green" },
  { name: ST.onHold, color: "red" },
] as const;
type Stage = (typeof STAGES)[number]["name"];
const OPEN: Stage[] = [ST.lead, ST.discovery, ST.proposal, ST.negotiation];
const ASK_TOPIC = anyOf(SALES.askTopic);
const ASK_ACT = anyOf(SALES.askAct);
const CALL_WORD = anyOf(SALES.callWords);
const WON_WORD = new RegExp(SALES.wonWords.join("|"), "i");
const ON_HOLD_WORD = new RegExp(SALES.onHoldWords.join("|"), "i");

/** Asked to build (or refresh) the pipeline. */
export function asksForPipeline(text: string): boolean {
  return ASK_TOPIC.test(text) && ASK_ACT.test(text);
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
  return /\.md$/i.test(path) && CALL_WORD.test(path) && !/readme\.md$/i.test(path) && !/(^|\/)ainmem-/.test(path);
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
  const from = fm[SALES.fm.started] ?? fm["date"] ?? fm["started"] ?? file.path.split("/").pop() ?? "";
  return from.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

function asStage(v: unknown): Stage {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return (STAGES.find((x) => x.name === s)?.name ?? (WON_WORD.test(s) ? ST.won : ON_HOLD_WORD.test(s) ? ST.onHold : ST.lead)) as Stage;
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
          `The call happened on ${date || "an unknown date"}; resolve relative dates (${SALES.examples.relativeDates.map((d) => `"${d}"`).join(", ")}) against it, in YYYY-MM-DD.\n` +
          "Output JSON only:\n" +
          `{"sales":true,"company":"<the customer company, short name, e.g. ${SALES.examples.company}>","contact":"<customer person and role>",` +
          `"stage":"<one of: ${STAGES.map((s) => s.name).join(" | ")}>","amount":<the latest amount in KRW as an integer (${SALES.examples.amount} → 108000000), or null>,` +
          '"product":"<what is being sold, short>","nextAction":"<the next step agreed, short Korean>","nextActionDate":"<YYYY-MM-DD or null>","summary":"<one short Korean sentence>"}\n' +
          'A personal or non-sales call (family, a dentist, a delivery) → {"sales":false}.\n' +
          `Stage guide: ${ST.lead} = first contact or interest only; ${ST.discovery} = needs/budget being discussed, a demo or visit being set up; ` +
          `${ST.proposal} = a proposal or quote has been sent/explained; ${ST.negotiation} = price or terms being negotiated; ${ST.won} = signed or confirmed; ${ST.onHold} = postponed or lost.`,
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
  const org = fm[SALES.fm.company] ?? fm["company"] ?? "";
  const company = asText(j.company, 60) || org.split(/\s+/)[0] || "";
  if (!company) return null;
  const amount = typeof j.amount === "number" && Number.isFinite(j.amount) && j.amount > 0 ? Math.round(j.amount) : null;
  return {
    sales: true,
    company,
    contact: asText(j.contact, 80) || [fm[SALES.fm.contact], org].filter(Boolean).join(" · "),
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

const COMPANY_NOISE = new RegExp(`\\s+|${SALES.companyForms.join("|")}`, "g");
const norm = (s: string) => s.replace(COMPANY_NOISE, "").toLowerCase();

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
  const order = (s: Stage) => (s === ST.onHold ? -1 : STAGES.findIndex((x) => x.name === s));
  return deals.sort((a, b) => order(b.stage) - order(a.stage) || (b.amount ?? 0) - (a.amount ?? 0));
}

const won = (n: number) =>
  n >= 100_000_000
    ? t("₩{n} × 100M", { n: (n / 100_000_000).toFixed(n % 100_000_000 ? 2 : 0).replace(/\.?0+$/, "") })
    : t("₩{n} × 10K", { n: Math.round(n / 10_000).toLocaleString("ko-KR") });

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
  const PR = SALES.props;
  const stageOptions = STAGES.map((s) => ({ id: crypto.randomUUID(), name: s.name, color: s.color }));
  const defs: { name: string; type: DbProperty["type"]; config?: DbProperty["config"] }[] = [
    { name: PR.company, type: "title" },
    { name: PR.stage, type: "select", config: { options: stageOptions } },
    { name: PR.amount, type: "number", config: { numberFormat: "comma" } },
    { name: PR.owner, type: "person" },
    { name: PR.contact, type: "text" },
    { name: PR.product, type: "text" },
    { name: PR.nextAction, type: "text" },
    { name: PR.due, type: "date" },
    { name: PR.lastCall, type: "date" },
    { name: PR.calls, type: "number" },
    { name: PR.summary, type: "text" },
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
          [P(PR.company)]: d.company,
          [P(PR.stage)]: stageOptions.find((o) => o.name === d.stage)!.id,
          [P(PR.amount)]: d.amount,
          [P(PR.owner)]: d.owners,
          [P(PR.contact)]: d.contact,
          [P(PR.product)]: d.product,
          [P(PR.nextAction)]: d.nextAction,
          [P(PR.due)]: d.nextActionDate ? { start: d.nextActionDate } : null,
          [P(PR.lastCall)]: d.lastCall ? { start: d.lastCall } : null,
          [P(PR.calls)]: d.calls.length,
          [P(PR.summary)]: d.summary,
        },
      }))
    );
  await db.insert(dbViews).values([
    {
      databaseId: database.id,
      name: SALES.views.board,
      type: "board" as const,
      // a card is who, how much and what next — the rest is one click away
      config: {
        groupByPropertyId: P(PR.stage),
        hiddenProperties: [PR.stage, PR.contact, PR.product, PR.lastCall, PR.calls, PR.summary].map(P),
      },
      position: 1,
    },
    {
      databaseId: database.id,
      name: SALES.views.table,
      type: "table" as const,
      config: { calcs: { [P(PR.amount)]: "sum", [P(PR.calls)]: "sum" } },
      position: 2,
    },
    { databaseId: database.id, name: SALES.views.calendar, type: "calendar" as const, config: { calendarDatePropertyId: P(PR.due) }, position: 3 },
    {
      databaseId: database.id,
      name: SALES.views.dashboard,
      type: "dashboard" as const,
      config: {
        widgets: [
          { id: crypto.randomUUID(), kind: "counter", title: SALES.widgets.companies, width: 1, aggregate: "count" },
          { id: crypto.randomUUID(), kind: "counter", title: SALES.widgets.amountSum, width: 1, aggregate: "sum", aggregatePropertyId: P(PR.amount) },
          { id: crypto.randomUUID(), kind: "bar", title: SALES.widgets.companiesByStage, width: 2, groupByPropertyId: P(PR.stage), aggregate: "count" },
          { id: crypto.randomUUID(), kind: "donut", title: SALES.widgets.amountByStage, width: 2, groupByPropertyId: P(PR.stage), aggregate: "sum", aggregatePropertyId: P(PR.amount) },
          { id: crypto.randomUUID(), kind: "board", title: SALES.widgets.board, width: 2, groupByPropertyId: P(PR.stage) },
        ],
      },
      position: 4,
    },
  ]);

  const open = deals.filter((d) => OPEN.includes(d.stage));
  const openSum = open.reduce((s, d) => s + (d.amount ?? 0), 0);
  const wonSum = deals.filter((d) => d.stage === ST.won).reduce((s, d) => s + (d.amount ?? 0), 0);
  const who = drives.map((d) => `${names.get(d.linkedBy ?? "") ?? d.name}`).join(" · ");
  const base = aindrivePublicBase();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = deals
    .filter((d) => d.nextActionDate && d.nextActionDate >= today && d.stage !== ST.onHold)
    .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""));

  const body: NewBlock[] = [
    {
      type: "callout",
      content: {
        icon: "📞",
        text:
          t("Read {calls} call records that {who}'s phones uploaded to aindrive and grouped {sales} sales calls into {deals} customers.", {
            who,
            calls,
            sales: facts.length,
            deals: deals.length,
          }) +
          " " +
          t("{open} in progress, {openSum}; won {wonSum}.", { open: open.length, openSum: won(openSum), wonSum: won(wonSum) }) +
          " " +
          t("When several people called the same customer they are merged into one row, and the latest call sets the stage."),
      },
    },
    { type: "database", content: { databaseId: database.id } },
    { type: "heading2", content: { text: t("Upcoming dates") } },
    ...(upcoming.length
      ? upcoming.map((d) => ({
          type: "todo" as const,
          content: { text: `${d.nextActionDate} · ${d.company} — ${d.nextAction} (${d.owners.map((o) => names.get(o) ?? "").join(", ")})`, checked: false },
        }))
      : [{ type: "paragraph" as const, content: { text: t("No next dates are scheduled.") } }]),
    { type: "heading2", content: { text: t("Source call records") } },
    { type: "paragraph", content: { text: t("Every row came from the calls below. The files stay in each person's aindrive; only links are here.") } },
    ...deals.map((d) => ({
      type: "toggle" as const,
      content: { text: `${d.company} — ${d.stage}${d.amount ? ` · ${won(d.amount)}` : ""} · ${t("{n} calls", { n: d.calls.length })}`, expanded: false },
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
  if (!workspaceId) return { pageId: null, text: t("This chat room isn't part of a workspace, so I can't find a linked aindrive.") };
  const { teamspaceId, drives, files, failed } = await gatherCalls(workspaceId, [...new Set([askerId, ...viewerIds])]);
  if (!teamspaceId || !files.length)
    return {
      pageId: null,
      text:
        t("I couldn't find call records in the linked aindrive. Link each person's phone call-history folder (aindrive) to a teamspace and I'll build the pipeline from there.") +
        (failed.length ? " " + t("(folders I couldn't open: {list})", { list: failed.join(", ") }) : ""),
    };
  await progress?.(
    t("Found {files} call records in {n} aindrive folders ({names}). Reading them one at a time and sorting by customer…", {
      n: drives.length,
      names: drives.map((d) => d.name).join(", "),
      files: files.length,
    })
  );
  const facts = (await inBatches(files, EXTRACT_CONCURRENCY, extract)).filter((f): f is CallFacts => f !== null);
  const deals = mergeDeals(facts);
  const { pageId, open, openSum, wonSum, upcoming } = await writePage(workspaceId, teamspaceId, askerId, deals, facts, files.length, drives);
  const skipped = files.length - facts.length;
  const lines = [
    t("Built the {title} → /p/{pageId}", { title: PIPELINE_TITLE, pageId }),
    t("{calls} calls → {deals} customers", { calls: files.length, deals: deals.length }) +
      (skipped ? " " + t("(left out {n} calls unrelated to sales)", { n: skipped }) : "") +
      ".",
    t("{open} in progress {openSum} · won {wonSum}", { open: open.length, openSum: won(openSum), wonSum: won(wonSum) }),
    ...STAGES.map((s) => {
      const ds = deals.filter((d) => d.stage === s.name);
      return ds.length ? `- ${s.name}: ${ds.map((d) => `${d.company}${d.amount ? `(${won(d.amount)})` : ""}`).join(", ")}` : "";
    }).filter(Boolean),
    ...(upcoming.length
      ? [t("Next up: {date} {company} — {action}", { date: upcoming[0].nextActionDate ?? "", company: upcoming[0].company, action: upcoming[0].nextAction })]
      : []),
    ...(failed.length ? [t("(folders I couldn't open: {list})", { list: failed.join(", ") })] : []),
  ];
  return { pageId, text: lines.join("\n") };
}
