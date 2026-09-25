import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  blocks,
  databases,
  dbProperties,
  dbRows,
  pages,
  teamspaceDrives,
  teamspaces,
  type Block,
  type Page,
} from "@/lib/db/schema";
import { blocksToMd, fm, slug } from "@/lib/md-mirror";
import { deletePath, parseLink, readFile, writeFile, type AindriveLink } from "@/lib/aindrive";
import { runAsOrService } from "@/lib/aindrive-account";

/**
 * A teamspace's content, backed up in OKF form to the aindrive folder the
 * teamspace is linked to (teamspace_drives).
 *
 * Layout — the same page-tree-as-folder-tree the md mirror writes, under one
 * folder so the files that were already in the linked folder stay untouched:
 *
 *   <link root>/ainmem-<Teamspace>-<id6>/
 *     Getting-Started-a1b2c3.md        leaf page (YAML frontmatter + Markdown)
 *     Projects-d4e5f6/                 page with children or databases
 *       _page.md                       its own content
 *       Roadmap-778899.md              child page
 *       Tasks-0a1b2c.csv               a database embedded in it (OKF: .csv = DB)
 *     _manifest.json                   what the latest backup consists of
 *
 * A page deleted (or archived, moved out, made restricted) here is deleted from
 * the backup too: each run compares against the previous _manifest.json and
 * removes what is no longer part of the teamspace — only paths the manifest
 * lists, so nothing else in the folder is ever touched.
 */

// ── OKF rendering ───────────────────────────────────────────────────────────

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One stored cell as the text a person would read in the table. */
function cellText(value: unknown, options: Map<string, string>): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => cellText(v, options)).join(", ");
  if (typeof value === "object") {
    const d = value as { start?: string; end?: string };
    if (d.start || d.end) return `${d.start ?? ""}${d.end ? ` → ${d.end}` : ""}`;
    return JSON.stringify(value);
  }
  const s = String(value);
  return options.get(s) ?? s; // select/status values are option ids
}

async function databaseCsv(databaseId: string): Promise<{ title: string; csv: string } | null> {
  const [database] = await db.select().from(databases).where(eq(databases.id, databaseId));
  if (!database) return null;
  const props = await db
    .select()
    .from(dbProperties)
    .where(eq(dbProperties.databaseId, databaseId))
    .orderBy(asc(dbProperties.position));
  const rows = await db.select().from(dbRows).where(eq(dbRows.databaseId, databaseId)).orderBy(asc(dbRows.position));
  const options = new Map<string, string>();
  for (const p of props) for (const o of p.config.options ?? []) options.set(o.id, o.name);
  const lines = [props.map((p) => csvCell(p.name)).join(",")];
  for (const r of rows) lines.push(props.map((p) => csvCell(cellText(r.values[p.id], options))).join(","));
  return { title: database.title, csv: `${lines.join("\n")}\n` };
}

export interface TeamspaceOkf {
  /** backup-folder-relative path → contents */
  files: Map<string, string>;
  /** page id → the file that holds its content */
  pageFiles: Map<string, string>;
  /** pages of the teamspace left out of the backup, and why */
  excluded: { page: Page; reason: "restricted" }[];
  /** every exported page, for status views */
  pages: Page[];
  /** page id → its last edit (the page row or any of its blocks) */
  lastEdited: Map<string, Date>;
}

/** Every file of the teamspace's backup, path → contents (relative to the
 *  backup folder). Restricted pages — participant-only records such as a
 *  relationship doc — are never exported, and neither is anything under them. */
export async function teamspaceOkfFiles(teamspaceId: string): Promise<Map<string, string>> {
  return (await teamspaceOkf(teamspaceId)).files;
}

export async function teamspaceOkf(teamspaceId: string): Promise<TeamspaceOkf> {
  const [ts] = await db.select().from(teamspaces).where(eq(teamspaces.id, teamspaceId));
  const files = new Map<string, string>();
  const pageFiles = new Map<string, string>();
  if (!ts) return { files, pageFiles, excluded: [], pages: [], lastEdited: new Map() };

  const all = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, ts.workspaceId), eq(pages.isArchived, false), eq(pages.restricted, false)));
  // the teamspace's pages are its roots plus everything beneath them
  const inTs = new Set(all.filter((p) => p.teamspaceId === teamspaceId).map((p) => p.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all)
      if (!inTs.has(p.id) && p.parentPageId && inTs.has(p.parentPageId)) {
        inTs.add(p.id);
        grew = true;
      }
  }
  const list = all.filter((p) => inTs.has(p.id));
  const blockRows = list.length
    ? await db
        .select()
        .from(blocks)
        .where(and(inArray(blocks.pageId, list.map((p) => p.id)), eq(blocks.alive, true)))
    : [];
  const byPage = new Map<string, Block[]>();
  for (const b of blockRows) byPage.set(b.pageId, [...(byPage.get(b.pageId) ?? []), b]);
  // a block edit bumps the block, not its page — the page's last edit is the later of both
  const lastEdited = new Map<string, Date>();
  for (const p of list) {
    let t = new Date(p.updatedAt).getTime();
    for (const b of byPage.get(p.id) ?? []) t = Math.max(t, new Date(b.updatedAt).getTime());
    lastEdited.set(p.id, new Date(t));
  }

  const csvs = new Map<string, { title: string; csv: string } | null>();
  async function dbCsv(id: string) {
    if (!csvs.has(id)) csvs.set(id, await databaseCsv(id));
    return csvs.get(id)!;
  }

  // a page is a root here when its parent is not part of this export
  const isRoot = (p: Page) => !p.parentPageId || !inTs.has(p.parentPageId);
  async function walk(dir: string, children: Page[]) {
    for (const page of children.sort((a, b) => a.position - b.position)) {
      const own = byPage.get(page.id) ?? [];
      const md = `${fm(page)}${blocksToMd(own, null)}\n`;
      const kids = list.filter((p) => p.parentPageId === page.id);
      const dbIds = [
        ...new Set(
          own.filter((b) => b.type === "database" && b.content.databaseId).map((b) => b.content.databaseId as string)
        ),
      ];
      const name = slug(page.title, page.id);
      if (!kids.length && !dbIds.length) {
        files.set(`${dir}${name}.md`, md);
        pageFiles.set(page.id, `${dir}${name}.md`);
        continue;
      }
      const sub = `${dir}${name}/`;
      files.set(`${sub}_page.md`, md);
      pageFiles.set(page.id, `${sub}_page.md`);
      for (const id of dbIds) {
        const d = await dbCsv(id);
        if (d) files.set(`${sub}${slug(d.title, id)}.csv`, d.csv);
      }
      await walk(sub, kids);
    }
  }
  await walk("", list.filter(isRoot));

  // restricted teamspace pages are named in the status view (so their absence
  // from the backup is explained), never their content
  const restrictedRoots = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.teamspaceId, teamspaceId),
        eq(pages.isArchived, false),
        eq(pages.restricted, true)
      )
    );
  return {
    files,
    pageFiles,
    excluded: restrictedRoots.map((page) => ({ page, reason: "restricted" as const })),
    pages: list,
    lastEdited,
  };
}

// ── writing to the drive ────────────────────────────────────────────────────

export function backupFolder(teamspace: { id: string; name: string }): string {
  return `ainmem-${slug(teamspace.name, teamspace.id)}`;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// What each teamspace's backup last wrote (path → hash), so a debounced run
// after one edit sends that one file rather than the whole teamspace. Lost on
// restart, which only costs one full write. Survives dev HMR via globalThis.
const WRITTEN_KEY = Symbol.for("app.aindrive.backup.written");
function written(): Map<string, Map<string, string>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Map<string, string>>>;
  return (g[WRITTEN_KEY] ??= new Map());
}

export interface BackupResult {
  files: number;
  written: number;
  deleted?: number;
  error?: string;
}

const MANIFEST = "_manifest.json";

/** Every folder a set of file paths lives in ("a/b/c.md" → "a", "a/b"). */
function dirsOf(files: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

/** What the previous backup left on the drive, from its manifest: the files it
 *  wrote plus the stale ones it could not delete yet ([] when there is none). */
async function previousFiles(target: AindriveLink, folder: string): Promise<string[]> {
  try {
    const m = JSON.parse(await readFile(target, `${folder}/${MANIFEST}`)) as { files?: unknown; stale?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : []);
    return [...strings(m.files), ...strings(m.stale)];
  } catch {
    return [];
  }
}

/** Paths to delete so the backup holds only `current`: whole folders that no
 *  longer hold anything (topmost only — deleting one takes its contents), then
 *  files that vanished from folders that remain. */
export function stalePaths(previous: string[], current: Iterable<string>): string[] {
  const now = new Set(current);
  const nowDirs = dirsOf(now);
  const goneDirs = [...dirsOf(previous)].filter((d) => !nowDirs.has(d));
  const topDirs = goneDirs.filter((d) => !goneDirs.some((o) => d.startsWith(`${o}/`)));
  const underGone = (f: string) => topDirs.some((d) => f.startsWith(`${d}/`));
  const files = previous.filter((f) => !now.has(f) && !underGone(f) && f !== MANIFEST);
  return [...topDirs.sort(), ...files.sort()];
}

/** Back one teamspace up now. Records the outcome on its teamspace_drives row. */
export async function backupTeamspace(teamspaceId: string): Promise<BackupResult> {
  const [link] = await db
    .select()
    .from(teamspaceDrives)
    .where(and(eq(teamspaceDrives.teamspaceId, teamspaceId), eq(teamspaceDrives.backup, true)));
  const [ts] = await db.select().from(teamspaces).where(eq(teamspaces.id, teamspaceId));
  if (!link || !ts) return { files: 0, written: 0, error: "not linked" };

  const record = (r: BackupResult) =>
    db
      .update(teamspaceDrives)
      .set({ lastBackupAt: new Date(), lastBackupFiles: r.files, lastBackupError: r.error ?? null })
      .where(eq(teamspaceDrives.id, link.id))
      .then(() => r);

  let target: AindriveLink | null;
  try {
    target = parseLink({ driveId: link.driveId, root: link.root });
  } catch (e) {
    return record({ files: 0, written: 0, error: (e as Error).message });
  }
  if (!target) return record({ files: 0, written: 0, error: "not linked" });

  const folder = backupFolder(ts);
  const cacheKey = `${link.id}:${link.driveId}/${link.root}`;
  const cache = written().get(cacheKey) ?? new Map<string, string>();
  let files: Map<string, string>;
  try {
    files = await teamspaceOkfFiles(teamspaceId);
  } catch (e) {
    return record({ files: 0, written: 0, error: (e as Error).message });
  }
  const manifestOf = (stale: string[]) =>
    `${JSON.stringify(
      {
        format: "okf",
        source: "ainmem",
        teamspace: { id: ts.id, name: ts.name },
        files: [...files.keys()].sort(),
        // no longer part of the teamspace but still on the drive (the server
        // could not delete them) — the next run tries again
        ...(stale.length ? { stale } : {}),
      },
      null,
      2
    )}\n`;

  // Order matters for a run that dies halfway: new content first, then the
  // deletions, and the manifest last — until it is rewritten, the old one
  // still lists everything a retry has left to clean up.
  let count = 0;
  let deleted = 0;
  try {
    const previous = await previousFiles(target, folder);
    for (const [rel, content] of files) {
      const h = sha(content);
      if (cache.get(rel) === h) continue;
      await writeFile(target, `${folder}/${rel}`, content);
      cache.set(rel, h);
      count++;
    }
    const stale = stalePaths(previous, files.keys());
    let left: string[] = [];
    for (const [i, rel] of stale.entries()) {
      const gone = await deletePath(target, `${folder}/${rel}`).then(
        () => true,
        (e: Error) => {
          // already gone (someone tidied up by hand) is the outcome we wanted
          if (/not_found|no entry|ENOENT/i.test(e.message)) return true;
          // an aindrive server from before delete_path: keep backing up, and
          // leave the stale files for a run against a server that can delete
          if (/unknown (skill|tool)|delete_path/i.test(e.message) && !/forbidden/i.test(e.message)) return false;
          throw e;
        }
      );
      if (!gone) {
        left = stale.slice(i);
        break;
      }
      for (const k of cache.keys()) if (k === rel || k.startsWith(`${rel}/`)) cache.delete(k);
      deleted++;
    }
    const manifest = manifestOf(left);
    if (cache.get(MANIFEST) !== sha(manifest)) {
      await writeFile(target, `${folder}/${MANIFEST}`, manifest);
      cache.set(MANIFEST, sha(manifest));
    }
  } catch (e) {
    written().set(cacheKey, cache); // what did land stays recorded
    return record({ files: files.size + 1, written: count, deleted, error: (e as Error).message });
  }
  written().set(cacheKey, cache);
  return record({ files: files.size + 1, written: count, deleted });
}

// One run per teamspace at a time; a request during a run queues one more.
const RUNS_KEY = Symbol.for("app.aindrive.backup.runs");
function runs(): Map<string, Promise<BackupResult>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<BackupResult>>>;
  return (g[RUNS_KEY] ??= new Map());
}

/** Back one teamspace up, as the account of whoever linked it. */
async function backupAsLinker(teamspaceId: string): Promise<BackupResult> {
  const [link] = await db
    .select({ createdBy: teamspaceDrives.createdBy })
    .from(teamspaceDrives)
    .where(and(eq(teamspaceDrives.teamspaceId, teamspaceId), eq(teamspaceDrives.backup, true)));
  try {
    return await runAsOrService(link?.createdBy, () => backupTeamspace(teamspaceId));
  } catch (e) {
    // the linker disconnected their aindrive — say so on the teamspace
    const r = { files: 0, written: 0, error: (e as Error).message };
    await db
      .update(teamspaceDrives)
      .set({ lastBackupAt: new Date(), lastBackupFiles: 0, lastBackupError: r.error })
      .where(and(eq(teamspaceDrives.teamspaceId, teamspaceId), eq(teamspaceDrives.backup, true)));
    return r;
  }
}

export function runBackup(teamspaceId: string): Promise<BackupResult> {
  const inflight = runs();
  const prev = inflight.get(teamspaceId) ?? Promise.resolve({ files: 0, written: 0 });
  const next = prev.catch(() => null).then(() => backupAsLinker(teamspaceId));
  inflight.set(teamspaceId, next);
  void next.finally(() => {
    if (inflight.get(teamspaceId) === next) inflight.delete(teamspaceId);
  });
  return next;
}

// ── debounced trigger (from md-mirror's scheduleMirror) ─────────────────────

const TIMER_KEY = Symbol.for("app.aindrive.backup.timers");
function timers(): Map<string, ReturnType<typeof setTimeout>> {
  const g = globalThis as unknown as Record<symbol, Map<string, ReturnType<typeof setTimeout>>>;
  return (g[TIMER_KEY] ??= new Map());
}

// longer than the mirror's 500ms: every run is a round of RPCs to someone's
// machine, and typing produces a mutation per keystroke burst
const BACKUP_DEBOUNCE_MS = 5_000;

/** After a workspace mutation: back up each of its linked teamspaces, once the
 *  edits settle. A workspace with no linked teamspace costs one query. */
export function scheduleDriveBackups(workspaceId: string): void {
  const map = timers();
  const existing = map.get(workspaceId);
  if (existing) clearTimeout(existing);
  map.set(
    workspaceId,
    setTimeout(() => {
      map.delete(workspaceId);
      void (async () => {
        const linked = await db
          .select({ teamspaceId: teamspaceDrives.teamspaceId })
          .from(teamspaceDrives)
          .innerJoin(teamspaces, eq(teamspaces.id, teamspaceDrives.teamspaceId))
          .where(and(eq(teamspaces.workspaceId, workspaceId), eq(teamspaceDrives.backup, true)));
        for (const { teamspaceId } of linked) {
          const r = await runBackup(teamspaceId);
          if (r.error) console.error(`[aindrive-backup] ${teamspaceId}: ${r.error}`);
        }
      })().catch((err) => console.error("[aindrive-backup] failed:", err));
    }, BACKUP_DEBOUNCE_MS)
  );
}
