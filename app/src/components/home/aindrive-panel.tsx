"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, File, FilePlus, Folder, HardDrive, Lock, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useT } from "@/i18n/provider";

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
  synced: "동기화됨",
  pending: "동기화 대기",
  failed: "동기화 실패",
  excluded: "동기화 제외",
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
}: {
  drives: Drive[];
  submit: (body: { driveId: string; root: string; name?: string }) => Promise<string | null>;
  onCancel: () => void;
  withName?: boolean;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [driveId, setDriveId] = useState(drives[0]?.id ?? "");
  const [root, setRoot] = useState(drives[0]?.root ?? "");
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
            {t("이름")}
          </label>
          <input
            id="aindrive-name"
            data-testid="aindrive-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("비우면 폴더 이름")}
            className={inputCls}
          />
        </div>
      )}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="aindrive-drive">
            {t("드라이브")}
          </label>
          {drives.length ? (
            <select
              id="aindrive-drive"
              data-testid="aindrive-drive-select"
              value={driveId}
              onChange={(e) => {
                setDriveId(e.target.value);
                setRoot(drives.find((d) => d.id === e.target.value)?.root ?? "");
              }}
              className={inputCls}
            >
              {drives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="aindrive-drive"
              data-testid="aindrive-drive-input"
              value={driveId}
              onChange={(e) => setDriveId(e.target.value)}
              placeholder={t("드라이브 ID")}
              className={inputCls}
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor="aindrive-root">
            {t("폴더 (비우면 드라이브 전체)")}
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
          {t("취소")}
        </button>
        <button data-testid="aindrive-link-submit" onClick={() => void submit()} disabled={busy || !driveId.trim()} className={primaryCls}>
          {busy ? t("연결 중…") : t("연결")}
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
}: {
  api: string;
  title: string;
  onUnlink?: () => void;
  unlinkLabel?: string;
  managed?: Managed;
}) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ path: string; content: string; saved: string; binary?: boolean } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPath, setNewPath] = useState<string | null>(null);

  // bumping `version` re-reads the tree (refresh, a newly saved file)
  const [version, setVersion] = useState(0);
  const loadTree = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetch(`${api}/tree`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          const msg = await errorOf(res, t("폴더를 읽을 수 없습니다"));
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
      .catch(() => alive && setTreeError(t("폴더를 읽을 수 없습니다")));
    return () => {
      alive = false;
    };
  }, [version, t, api]);

  const dirty = open ? open.content !== open.saved : false;
  const leaveOk = () => !dirty || window.confirm(t("저장하지 않은 변경 사항이 사라집니다. 계속할까요?"));

  const isManaged = (path: string) =>
    !!managed && (path === managed.prefix || path.startsWith(`${managed.prefix}/`));
  const openManaged = open && isManaged(open.path) ? managed!.files.get(open.path) : undefined;
  const openReadOnly = !!open && (open.binary || isManaged(open.path));

  async function openFile(path: string) {
    if (!leaveOk()) return;
    setFileError(null);
    setNewPath(null);
    setBusy(true);
    const res = await fetch(`${api}/file?path=${encodeURIComponent(path)}`);
    setBusy(false);
    if (!res.ok) return setFileError(await errorOf(res, t("파일을 읽을 수 없습니다")));
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
    if (!res.ok) return setFileError(await errorOf(res, t("저장할 수 없습니다")));
    setOpen({ ...open, saved: open.content });
    // a new file only shows up in the tree once it exists on the drive
    if (!entries?.some((e) => e.path === open.path)) loadTree();
  }

  async function remove(e: Entry) {
    const message = e.isDir
      ? t("{path} 폴더와 그 안의 모든 파일을 드라이브에서 삭제할까요?", { path: e.path })
      : t("{path} 파일을 드라이브에서 삭제할까요?", { path: e.path });
    if (!window.confirm(message)) return;
    setFileError(null);
    const res = await fetch(`${api}/file?path=${encodeURIComponent(e.path)}`, { method: "DELETE" });
    if (!res.ok) return setFileError(await errorOf(res, t("삭제할 수 없습니다")));
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
          <span className="text-xs text-neutral-400">{t("파일 {n}개", { n: files })}</span>
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
            <FilePlus size={13} /> {t("새 파일")}
          </button>
          <button data-testid="aindrive-refresh" onClick={loadTree} className={btnCls}>
            <RefreshCw size={13} /> {t("새로고침")}
          </button>
          {onUnlink && (
            <button data-testid="aindrive-unlink" onClick={onUnlink} className={btnCls}>
              <Unlink size={13} /> {unlinkLabel ?? t("연결 해제")}
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-[20rem] grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul
          data-testid="aindrive-tree"
          className="max-h-[28rem] overflow-y-auto border-b border-neutral-100 py-1 md:border-b-0 md:border-r dark:border-neutral-800"
        >
          {entries === null && <li className="px-3 py-2 text-xs text-neutral-400">{t("불러오는 중…")}</li>}
          {treeError && <li className="px-3 py-2 text-xs text-red-600">{treeError}</li>}
          {entries && !treeError && entries.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-400">{t("빈 폴더입니다")}</li>
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
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("팀스페이스에서 동기화됨")}
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full border border-neutral-300 dark:border-neutral-600" /> {t("aindrive 원본 · 연동 안 됨")}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                  {group.key === "managed"
                    ? t("페이지에서 자동으로 동기화되는 파일입니다. 수정은 페이지에서 하세요.")
                    : t("ainmem과 동기화되지 않는 드라이브의 파일입니다. 여기서 고치면 드라이브에만 반영됩니다.")}
                </p>
                {group.rows.length === 0 && <p className="py-1 text-xs text-neutral-400">{t("없음")}</p>}
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
                    open?.path === e.path ? "bg-neutral-100 dark:bg-neutral-800" : ""
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
                      title={page ? `${page.title || t("제목 없음")} · ${t(SYNC_LABEL[page.status])}` : t("자동 생성")}
                      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${page ? SYNC_DOT[page.status] : "bg-neutral-300 dark:bg-neutral-600"}`}
                    />
                  )}
                </button>
                {group.key !== "managed" && (
                <button
                  data-testid={`aindrive-delete-${e.path}`}
                  onClick={() => void remove(e)}
                  aria-label={t("삭제")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-red-600 focus-visible:opacity-100 group-hover/entry:opacity-100 dark:hover:bg-neutral-700"
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
                placeholder={t("새 파일 경로 (예: memo/today.md)")}
                className={inputCls}
              />
              <button
                data-testid="aindrive-new-create"
                disabled={!newPath.trim()}
                onClick={() => {
                  const path = newPath.trim().replace(/^\/+|\/+$/g, "");
                  const existing = entries?.find((e) => e.path === path);
                  if (existing?.isDir) return setFileError(t("같은 이름의 폴더가 있습니다"));
                  // an existing file is opened, not replaced with an empty one
                  if (existing) return void openFile(path);
                  setFileError(null);
                  setOpen({ path, content: "", saved: "\u0000" });
                  setNewPath(null);
                }}
                className={primaryCls}
              >
                {t("만들기")}
              </button>
            </div>
          )}
          {fileError && <p className="mb-2 text-sm text-red-600">{fileError}</p>}
          {open ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span data-testid="aindrive-open-path" className="truncate font-mono text-xs text-neutral-500">
                  {open.path}
                </span>
                {isManaged(open.path) ? (
                  <span className="flex items-center gap-1 text-xs text-neutral-400">
                    <Lock size={11} /> {t("읽기 전용")}
                  </span>
                ) : open.binary ? (
                  <span className="text-xs text-neutral-400">{t("텍스트 파일이 아니라 읽기 전용입니다")}</span>
                ) : (
                  dirty && <span className="text-xs text-amber-600">{t("저장 안 됨")}</span>
                )}
                {!openReadOnly && (
                  <button
                    data-testid="aindrive-save"
                    onClick={() => void save()}
                    disabled={busy || !dirty}
                    className={`ml-auto ${primaryCls}`}
                  >
                    {busy ? t("저장 중…") : t("저장")}
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
                        {t("페이지 {title}에서 자동으로 동기화되는 파일입니다 ({status}).", {
                          title: `‘${openManaged.title || t("제목 없음")}’`,
                          status: t(SYNC_LABEL[openManaged.status]),
                        })}
                      </span>
                      <Link
                        data-testid="aindrive-managed-open-page"
                        href={`/p/${openManaged.pageId}`}
                        className="ml-auto font-medium underline underline-offset-2"
                      >
                        {t("페이지에서 수정")}
                      </Link>
                    </>
                  ) : (
                    <span>{t("동기화가 자동으로 만드는 파일입니다.")}</span>
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
                {busy ? t("불러오는 중…") : t("왼쪽에서 파일을 고르면 내용이 여기에 보입니다.")}
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
  const [state, setState] = useState<{ configured: boolean; link: DriveLink | null; drives: Drive[] } | null>(null);
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
    if (!window.confirm(t("aindrive 연결을 해제할까요? 드라이브의 파일은 지워지지 않습니다."))) return;
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
      {!state.configured ? (
        <p className="text-sm text-neutral-400">{t("이 서버에는 aindrive가 설정되어 있지 않습니다.")}</p>
      ) : state.link ? (
        <Browser
          key={`${state.link.driveId}/${state.link.root}`}
          api="/api/aindrive"
          title={`${driveName}${state.link.root ? ` / ${state.link.root}` : ""}`}
          onUnlink={() => void unlink()}
        />
      ) : linking ? (
        <LinkForm
          drives={state.drives}
          onCancel={() => setLinking(false)}
          submit={async (body) => {
            const res = await fetch("/api/aindrive", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) return errorOf(res, t("연결할 수 없습니다"));
            setLinking(false);
            load();
            return null;
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-neutral-300 px-4 py-4 dark:border-neutral-700">
          <p className="text-sm text-neutral-500">
            {t("내 컴퓨터의 폴더를 aindrive로 연결하면 여기서 파일을 보고 고칠 수 있습니다.")}
          </p>
          <button data-testid="aindrive-link" onClick={() => setLinking(true)} className={`shrink-0 ${primaryCls}`}>
            {t("aindrive 연결")}
          </button>
        </div>
      )}
    </section>
  );
}
