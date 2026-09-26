"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, File, FilePlus, Folder, HardDrive, Lock, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useT } from "@/i18n/provider";
import { FilePreview, previewKindFor } from "@/components/previews";
import { aindriveRawUrl } from "@/lib/aindrive-url";
import { AindriveAccountBadge, AindriveConnect } from "@/components/aindrive/aindrive-connect";

/**
 * Home's aindrive section: link a folder from one of the drives this server
 * offers, then see everything in it — every folder expanded, every file one
 * click from its contents — and edit or add files in place. The bytes stay on
 * the machine running the aindrive CLI; this only relays reads and writes
 * (api/aindrive → lib/aindrive → aindrive's MCP).
 */

interface DriveLink {
  driveId: string;
  root: string;
}

export type SyncState = "synced" | "pending" | "failed" | "excluded";
export const SYNC_DOT: Record<SyncState, string> = {
  synced: "bg-emerald-500",
  pending: "bg-amber-400",
  failed: "bg-red-500",
  excluded: "bg-neutral-300 dark:bg-neutral-600",
};
export const SYNC_LABEL: Record<SyncState, string> = {
  synced: "Synced",
  pending: "Sync pending",
  failed: "Sync failed",
  excluded: "Not synced",
};

/** The part of a folder this app writes (a teamspace's OKF backup): shown as
 *  its own group, each file tied to the page it comes from, never edited here —
 *  the next backup would overwrite the edit. */
export interface Managed {
  /** folder path, relative to the linked folder */
  prefix: string;
  /** file path → the page it is generated from */
  files: Map<string, { pageId: string; title: string; status: SyncState }>;
}
export interface Drive {
  id: string;
  name: string;
  root: string;
  /** its aindrive CLI is connected — only then can its files be read */
  online?: boolean;
}
interface Entry {
  path: string;
  isDir: boolean;
  size?: number;
}

const inputCls =
  "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800";
const btnCls =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";
const primaryCls =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";

/** utf8 decoding of a binary file shows up as replacement or NUL characters;
 *  such a file is shown but never saved back, which would corrupt it. */
const looksBinary = (s: string) => /[\u0000\uFFFD]/.test(s);

export async function errorOf(res: Response, fallback: string) {
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback;
}

/** Pick a drive and a folder in it. `submit` does the linking and returns an
 *  error message, or null once it worked. `withName` adds a name field (a
 *  teamspace entry has one; Home's personal link does not). */
export function LinkForm({
  drives,
  submit: send,
  onCancel,
  withName = false,
  accountBadge,
  onRefresh,
}: {
  drives: Drive[];
  submit: (body: { driveId: string; root: string; name?: string }) => Promise<string | null>;
  onCancel: () => void;
  withName?: boolean;
  /** which aindrive account these drives are (AindriveAccountBadge) */
  accountBadge?: React.ReactNode;
  /** re-read the drives (and whether they are online) */
  onRefresh?: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  // start on a drive that can actually be read
  const first = drives.find((d) => d.online !== false) ?? null;
  const [driveId, setDriveId] = useState(first?.id ?? "");
  const [root, setRoot] = useState(first?.root ?? "");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const err = await send({
      driveId: driveId.trim(),
      root: root.trim(),
      ...(withName ? { name: name.trim() } : {}),
    });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
      {withName && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="aindrive-name">
            {t("Name")}
          </label>
          <input
            id="aindrive-name"
            data-testid="aindrive-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Blank = the folder's name")}
            className={inputCls}
          />
        </div>
      )}
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">{t("Drive")}</span>
          {accountBadge}
          {onRefresh && (
            <button
              type="button"
              data-testid="aindrive-drives-refresh"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await onRefresh();
                setRefreshing(false);
              }}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} /> {t("Refresh status")}
            </button>
          )}
        </div>
        {drives.length ? (
          <ul
            role="radiogroup"
            aria-label={t("Drive")}
            data-testid="aindrive-drive-list"
            className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700"
          >
            {drives.map((d) => {
              const offline = d.online === false;
              const on = d.id === driveId;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={offline}
                    data-testid={`aindrive-drive-option-${d.id}`}
                    data-online={offline ? "false" : "true"}
                    onClick={() => {
                      if (offline) return;
                      setDriveId(d.id);
                      setRoot(d.root);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      offline
                        ? "cursor-not-allowed text-neutral-400"
                        : on
                          ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                          : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800/60"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        on ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-600"
                      }`}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-neutral-900 dark:bg-neutral-100" />}
                    </span>
                    <HardDrive size={14} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span
                      className={`flex shrink-0 items-center gap-1 text-[11px] ${
                        offline ? "text-neutral-400" : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-neutral-300 dark:bg-neutral-600" : "bg-emerald-500"}`} />
                      {offline ? t("Offline") : t("Connected")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <input
            id="aindrive-drive"
            data-testid="aindrive-drive-input"
            value={driveId}
            onChange={(e) => setDriveId(e.target.value)}
            placeholder={t("Drive ID")}
            className={inputCls}
          />
        )}
        {drives.some((d) => d.online === false) && (
          <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">
            {t("Offline drives become selectable once aindrive is running on the computer that holds the folder.")}
          </p>
        )}
      </div>
      <div className="mb-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="aindrive-root">
            {t("Folder (blank = whole drive)")}
          </label>
          <input
            id="aindrive-root"
            data-testid="aindrive-root-input"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="notes"
            className={inputCls}
          />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
          {t("Cancel")}
        </button>
        <button data-testid="aindrive-link-submit" onClick={() => void submit()} disabled={busy || !driveId.trim()} className={primaryCls}>
          {busy ? t("Linking…") : t("Connect")}
        </button>
      </div>
    </div>
  );
}

/** Everything in one linked folder. `api` is where its tree and files are
 *  served (`${api}/tree`, `${api}/file`); `onUnlink` adds an unlink button. */
export function Browser({
  api,
  title,
  onUnlink,
  unlinkLabel,
  managed,
  rawUrl,
}: {
  api: string;
  title: string;
  onUnlink?: () => void;
  unlinkLabel?: string;
  managed?: Managed;
  /** where a file's raw bytes are served — given, anything that is not text
   *  (photos, pdf, office files, video…) opens as a preview instead */
  rawUrl?: (path: string) => string;
}) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ path: string; content: string; saved: string; binary?: boolean } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPath, setNewPath] = useState<string | null>(null);
  // a non-text file shown through FilePreview (rawUrl), instead of the editor
  const [previewing, setPreviewing] = useState<string | null>(null);

  // bumping `version` re-reads the tree (refresh, a newly saved file)
  const [version, setVersion] = useState(0);
  const loadTree = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetch(`${api}/tree`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          const msg = await errorOf(res, t("Could not read the folder"));
          if (!alive) return;
          setEntries([]);
          setTreeError(msg);
          return;
        }
        const { entries } = (await res.json()) as { entries: Entry[] };
        if (!alive) return;
        setTreeError(null);
        setEntries(entries);
      })
      .catch(() => alive && setTreeError(t("Could not read the folder")));
    return () => {
      alive = false;
    };
  }, [version, t, api]);

  const dirty = open ? open.content !== open.saved : false;
  const leaveOk = () => !dirty || window.confirm(t("Unsaved changes will be lost. Continue?"));

  const isManaged = (path: string) =>
    !!managed && (path === managed.prefix || path.startsWith(`${managed.prefix}/`));
  const openManaged = open && isManaged(open.path) ? managed!.files.get(open.path) : undefined;
  const openReadOnly = !!open && (open.binary || isManaged(open.path));

  async function openFile(path: string) {
    if (!leaveOk()) return;
    setFileError(null);
    // not text: show it, don't load it into the editor as mangled characters
    const kind = previewKindFor(path);
    if (rawUrl && kind !== "text" && kind !== "markdown") {
      setNewPath(null);
      setOpen(null);
      setPreviewing(path);
      return;
    }
    setPreviewing(null);
    setNewPath(null);
    setBusy(true);
    const res = await fetch(`${api}/file?path=${encodeURIComponent(path)}`);
    setBusy(false);
    if (!res.ok) return setFileError(await errorOf(res, t("Could not read the file")));
    const { content } = (await res.json()) as { content: string };
    setOpen({ path, content, saved: content, binary: looksBinary(content) });
  }

  async function save() {
    if (!open || open.binary || isManaged(open.path)) return;
    setBusy(true);
    setFileError(null);
    const res = await fetch(`${api}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: open.path, content: open.content }),
    });
    setBusy(false);
    if (!res.ok) return setFileError(await errorOf(res, t("Can't save")));
    setOpen({ ...open, saved: open.content });
    // a new file only shows up in the tree once it exists on the drive
    if (!entries?.some((e) => e.path === open.path)) loadTree();
  }

  async function remove(e: Entry) {
    const message = e.isDir
      ? t("Delete the folder {path} and everything in it from the drive?", { path: e.path })
      : t("Delete {path} from the drive?", { path: e.path });
    if (!window.confirm(message)) return;
    setFileError(null);
    const res = await fetch(`${api}/file?path=${encodeURIComponent(e.path)}`, { method: "DELETE" });
    if (!res.ok) return setFileError(await errorOf(res, t("Could not delete")));
    // whatever was open inside what just went is gone with it
    if (open && (open.path === e.path || open.path.startsWith(`${e.path}/`))) setOpen(null);
    loadTree();
  }

  // a folder hides everything under it while collapsed
  const visible = useMemo(
    () =>
      (entries ?? []).filter(
        (e) => ![...collapsed].some((c) => e.path.startsWith(`${c}/`))
      ),
    [entries, collapsed]
  );
  const files = entries?.filter((e) => !e.isDir).length ?? 0;

  return (
    <div data-testid="aindrive-browser" className="rounded-xl border border-neutral-200 dark:border-neutral-700">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <HardDrive size={14} className="text-neutral-400" />
        <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</span>
        {entries && (
          <span className="text-xs text-neutral-400">{t("{n} files", { n: files })}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            data-testid="aindrive-new-file"
            onClick={() => {
              if (!leaveOk()) return;
              setNewPath("");
              setOpen(null);
            }}
            className={btnCls}
          >
            <FilePlus size={13} /> {t("New file")}
          </button>
          <button data-testid="aindrive-refresh" onClick={loadTree} className={btnCls}>
            <RefreshCw size={13} /> {t("Refresh")}
          </button>
          {onUnlink && (
            <button data-testid="aindrive-unlink" onClick={onUnlink} className={btnCls}>
              <Unlink size={13} /> {unlinkLabel ?? t("Disconnect")}
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-[20rem] grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul
          data-testid="aindrive-tree"
          className="max-h-[28rem] overflow-y-auto border-b border-neutral-100 py-1 md:border-b-0 md:border-r dark:border-neutral-800"
        >
          {entries === null && <li className="px-3 py-2 text-xs text-neutral-400">{t("Loading…")}</li>}
          {treeError && <li className="px-3 py-2 text-xs text-red-600">{treeError}</li>}
          {entries && !treeError && entries.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-400">{t("The folder is empty")}</li>
          )}
          {(managed
            ? [
                { key: "managed", rows: visible.filter((e) => isManaged(e.path) && e.path !== managed.prefix) },
                { key: "own", rows: visible.filter((e) => !isManaged(e.path)) },
              ]
            : [{ key: "all", rows: visible }]
          ).flatMap((group) => [
            group.key !== "all" && (
              <li
                key={`group-${group.key}`}
                data-testid={`aindrive-group-${group.key}`}
                className={`px-3 pb-1 ${group.key === "own" ? "mt-2 border-t border-neutral-100 pt-3 dark:border-neutral-800" : "pt-2"}`}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  {group.key === "managed" ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("Synced from the teamspace")}
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full border border-neutral-300 dark:border-neutral-600" /> {t("aindrive originals · not synced")}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                  {group.key === "managed"
                    ? t("Files synced from pages. Edit them in the page.")
                    : t("Files on the drive that ainmem does not sync. Edits here change the drive only.")}
                </p>
                {group.rows.length === 0 && <p className="py-1 text-xs text-neutral-400">{t("None")}</p>}
              </li>
            ),
            ...group.rows.map((e) => {
            // the managed folder itself is the group header, so its contents start at the left
            const depth = e.path.split("/").length - 1 - (group.key === "managed" ? 1 : 0);
            const page = managed?.files.get(e.path);
            const name = e.path.slice(e.path.lastIndexOf("/") + 1);
            const shut = collapsed.has(e.path);
            return (
              <li key={e.path} className="group/entry relative">
                <button
                  data-testid={`aindrive-entry-${e.path}`}
                  onClick={() => {
                    if (!e.isDir) return void openFile(e.path);
                    setCollapsed((s) => {
                      const n = new Set(s);
                      if (n.has(e.path)) n.delete(e.path);
                      else n.add(e.path);
                      return n;
                    });
                  }}
                  style={{ paddingLeft: 12 + depth * 16 }}
                  className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60 ${
                    open?.path === e.path || previewing === e.path ? "bg-neutral-100 dark:bg-neutral-800" : ""
                  }`}
                >
                  {e.isDir ? (
                    <>
                      {shut ? <ChevronRight size={12} className="text-neutral-400" /> : <ChevronDown size={12} className="text-neutral-400" />}
                      <Folder size={14} className="shrink-0 text-neutral-400" />
                    </>
                  ) : (
                    <File size={14} className="ml-[18px] shrink-0 text-neutral-400" />
                  )}
                  <span className="truncate text-neutral-700 dark:text-neutral-200">{name}</span>
                  {group.key === "managed" && !e.isDir && (
                    <span
                      data-testid={`aindrive-sync-${e.path}`}
                      title={page ? `${page.title || t("Untitled")} · ${t(SYNC_LABEL[page.status])}` : t("Generated")}
                      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${page ? SYNC_DOT[page.status] : "bg-neutral-300 dark:bg-neutral-600"}`}
                    />
                  )}
                </button>
                {group.key !== "managed" && (
                <button
                  data-testid={`aindrive-delete-${e.path}`}
                  onClick={() => void remove(e)}
                  aria-label={t("Delete")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 touch-reveal opacity-0 hover:bg-neutral-200 hover:text-red-600 focus-visible:opacity-100 group-hover/entry:opacity-100 dark:hover:bg-neutral-700"
                >
                  <Trash2 size={13} />
                </button>
                )}
              </li>
            );
          }),
          ])}
        </ul>

        <div className="flex min-w-0 flex-col p-3">
          {newPath !== null && (
            <div className="mb-3 flex gap-2">
              <input
                data-testid="aindrive-new-path"
                autoFocus
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder={t("New file path (e.g. memo/today.md)")}
                className={inputCls}
              />
              <button
                data-testid="aindrive-new-create"
                disabled={!newPath.trim()}
                onClick={() => {
                  const path = newPath.trim().replace(/^\/+|\/+$/g, "");
                  const existing = entries?.find((e) => e.path === path);
                  if (existing?.isDir) return setFileError(t("A folder with that name already exists"));
                  // an existing file is opened, not replaced with an empty one
                  if (existing) return void openFile(path);
                  setFileError(null);
                  setOpen({ path, content: "", saved: "\u0000" });
                  setNewPath(null);
                }}
                className={primaryCls}
              >
                {t("Create")}
              </button>
            </div>
          )}
          {fileError && <p className="mb-2 text-sm text-red-600">{fileError}</p>}
          {previewing && rawUrl && !open ? (
            <div data-testid="aindrive-preview" className="flex min-h-[18rem] flex-1 flex-col">
              <FilePreview
                key={previewing}
                src={{ name: previewing.slice(previewing.lastIndexOf("/") + 1), url: rawUrl(previewing) }}
                compact
              />
            </div>
          ) : open ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span data-testid="aindrive-open-path" className="truncate font-mono text-xs text-neutral-500">
                  {open.path}
                </span>
                {isManaged(open.path) ? (
                  <span className="flex items-center gap-1 text-xs text-neutral-400">
                    <Lock size={11} /> {t("Read-only")}
                  </span>
                ) : open.binary ? (
                  <span className="text-xs text-neutral-400">{t("Not a text file — read-only")}</span>
                ) : (
                  dirty && <span className="text-xs text-amber-600">{t("Unsaved")}</span>
                )}
                {!openReadOnly && (
                  <button
                    data-testid="aindrive-save"
                    onClick={() => void save()}
                    disabled={busy || !dirty}
                    className={`ml-auto ${primaryCls}`}
                  >
                    {busy ? t("Saving…") : t("Save")}
                  </button>
                )}
              </div>
              {isManaged(open.path) && (
                <div
                  data-testid="aindrive-managed-note"
                  className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  {openManaged ? (
                    <>
                      <span className={`h-1.5 w-1.5 rounded-full ${SYNC_DOT[openManaged.status]}`} />
                      <span>
                        {t("Synced from the page {title} ({status}).", {
                          title: `‘${openManaged.title || t("Untitled")}’`,
                          status: t(SYNC_LABEL[openManaged.status]),
                        })}
                      </span>
                      <Link
                        data-testid="aindrive-managed-open-page"
                        href={`/p/${openManaged.pageId}`}
                        className="ml-auto font-medium underline underline-offset-2"
                      >
                        {t("Edit in the page")}
                      </Link>
                    </>
                  ) : (
                    <span>{t("A file the sync generates.")}</span>
                  )}
                </div>
              )}
              <textarea
                data-testid="aindrive-editor"
                value={open.content}
                readOnly={openReadOnly}
                onChange={(e) => setOpen({ ...open, content: e.target.value })}
                spellCheck={false}
                className="min-h-[18rem] w-full flex-1 resize-y rounded-md border border-neutral-200 p-2.5 font-mono text-xs leading-relaxed dark:border-neutral-700 dark:bg-neutral-800"
              />
            </>
          ) : (
            newPath === null && (
              <p className="m-auto text-sm text-neutral-400">
                {busy ? t("Loading…") : t("Pick a file on the left to see it here.")}
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function AindrivePanel() {
  const t = useT();
  const [state, setState] = useState<{
    configured: boolean;
    connected?: boolean;
    base?: string | null;
    link: DriveLink | null;
    drives: Drive[];
  } | null>(null);
  const [linking, setLinking] = useState(false);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/aindrive")
      .then((res) => (res.ok ? res.json() : { configured: false, link: null, drives: [] }))
      .then((d) => alive && setState(d))
      .catch(() => alive && setState({ configured: false, link: null, drives: [] }));
    return () => {
      alive = false;
    };
  }, [version]);

  async function unlink() {
    if (!window.confirm(t("Unlink aindrive? Files on the drive are not deleted."))) return;
    await fetch("/api/aindrive", { method: "DELETE" });
    load();
  }

  if (!state) return null;
  const driveName = state.link
    ? state.drives.find((d) => d.id === state.link!.driveId)?.name ?? state.link.driveId
    : "";

  return (
    <section data-testid="home-aindrive" className="mb-10">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <HardDrive size={12} /> aindrive
      </h2>
      {state.configured && (state.connected || state.link) && (
        <div className="mb-2">
          <AindriveAccountBadge />
        </div>
      )}
      {!state.configured ? (
        <p className="text-sm text-neutral-400">{t("aindrive is not configured on this server.")}</p>
      ) : !state.connected ? (
        <AindriveConnect onConnected={load} />
      ) : state.link ? (
        <Browser
          key={`${state.link.driveId}/${state.link.root}`}
          api="/api/aindrive"
          title={`${driveName}${state.link.root ? ` / ${state.link.root}` : ""}`}
          rawUrl={(path) =>
            aindriveRawUrl({ driveId: state.link!.driveId, path: state.link!.root ? `${state.link!.root}/${path}` : path })
          }
          onUnlink={() => void unlink()}
        />
      ) : linking ? (
        <LinkForm
          key={state.drives.map((d) => `${d.id}:${d.online}`).join(",")}
          drives={state.drives}
          onRefresh={async () => load()}
          onCancel={() => setLinking(false)}
          submit={async (body) => {
            const res = await fetch("/api/aindrive", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) return errorOf(res, t("Could not link"));
            setLinking(false);
            load();
            return null;
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-neutral-300 px-4 py-4 dark:border-neutral-700">
          <p className="text-sm text-neutral-500">
            {t("Link a folder on your computer through aindrive to view and edit its files here.")}
          </p>
          <button data-testid="aindrive-link" onClick={() => setLinking(true)} className={`shrink-0 ${primaryCls}`}>
            {t("Link aindrive")}
          </button>
        </div>
      )}
    </section>
  );
}
