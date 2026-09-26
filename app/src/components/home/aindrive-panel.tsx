"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/provider";
import { AinuiDriveBrowser } from "@/components/ainui/drive-browser";
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

const inputCls =
  "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800";
const primaryCls =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";


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
export function Browser({ api, title, onUnlink, unlinkLabel, managed }: {
  api: string; title: string; onUnlink?: () => void; unlinkLabel?: string;
  managed?: Managed; rawUrl?: (path: string) => string;
}) {
  const t = useT();
  return <div data-testid="aindrive-browser">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="truncate text-sm font-medium">{title}</h3>
      {onUnlink && <button onClick={onUnlink} className="text-xs text-neutral-500">{unlinkLabel ?? t("Unlink")}</button>}
    </div>
    <AinuiDriveBrowser source={api} />
    {managed && <p className="mt-2 text-xs text-neutral-500">{t("Backed-up pages are read-only here.")}</p>}
  </div>;
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
