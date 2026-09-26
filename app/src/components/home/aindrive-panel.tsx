"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { AinuiButton, AinuiForm, AinuiText } from "@/components/ainui/surface";
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
  const first = drives.find((d) => d.online !== false);
  const [driveId, setDriveId] = useState(first?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const selected = drives.find((d) => d.id === driveId);
  return <div className="rounded-xl border p-4">
    {accountBadge}
    {onRefresh && <AinuiButton label={t("Refresh status")} onClick={onRefresh} />}
    <AinuiText text={t("Drive")} />
    {drives.map((d) => <AinuiButton key={d.id} label={`${d.id === driveId ? "✓ " : ""}${d.name} · ${d.online === false ? t("Offline") : t("Connected")}`} disabled={d.online === false} onClick={() => setDriveId(d.id)} />)}
    <AinuiForm key={driveId} testId="aindrive-link-form" fields={[
      ...(!drives.length ? [{ key: "driveId", label: t("Drive ID"), value: "" }] : []),
      ...(withName ? [{ key: "name", label: t("Name"), value: "" }] : []),
      { key: "root", label: t("Folder (blank = whole drive)"), value: selected?.root ?? "" },
    ]} submitLabel={t("Connect")} disabled={!!drives.length && !selected} onSubmit={async (v) => {
      const chosen = drives.length ? driveId : String(v.driveId ?? "").trim();
      if (!chosen) throw new Error(t("Drive ID"));
      const err = await send({ driveId: chosen, root: String(v.root ?? "").trim(), ...(withName ? { name: String(v.name ?? "").trim() } : {}) });
      setError(err);
    }} />
    {error && <p role="alert">{error}</p>}
    <AinuiButton label={t("Cancel")} onClick={onCancel} />
  </div>;

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
      <AinuiText text={title} />
      {onUnlink && <AinuiButton label={unlinkLabel ?? t("Unlink")} onClick={onUnlink} />}
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
          <AinuiButton testId="aindrive-link" onClick={() => setLinking(true)} label={t("Link aindrive")} />
        </div>
      )}
    </section>
  );
}
