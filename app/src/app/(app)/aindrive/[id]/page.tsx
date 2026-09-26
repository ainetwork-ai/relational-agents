"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { AinuiButton, AinuiText } from "@/components/ainui/surface";
import { useRouter } from "next/navigation";
import { Browser, errorOf, SYNC_LABEL, type Managed, type SyncState } from "@/components/home/aindrive-panel";
import { STATE_LABEL, driveState } from "@/components/sidebar/teamspace-drive";
import { useT } from "@/i18n/provider";
import { FileShareCard, type FileShareInfo } from "@/components/aindrive/file-share-card";

interface SyncPage {
  id: string;
  title: string;
  icon: string | null;
  path: string | null;
  status: SyncState;
}

interface DriveMeta {
  drive: {
    id: string;
    teamspaceId: string;
    name: string;
    driveId: string;
    root: string;
    lastBackupAt: string | null;
    lastBackupFiles: number | null;
    lastBackupError: string | null;
    backup: boolean;
  };
  linkedBy: string | null;
  teamspaceName: string;
  backupFolder: string;
  available: boolean;
}

/** A teamspace's aindrive folder: the backup's state, and everything in the
 *  folder — the teamspace's OKF backup and whatever was already there. */
export default function TeamspaceDrivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const router = useRouter();
  const [meta, setMeta] = useState<DriveMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [sync, setSync] = useState<SyncPage[] | null>(null);
  const [showPages, setShowPages] = useState(false);
  // a link can be a single file (shared from aindrive's share sheet) — maybe on sale
  const [fileInfo, setFileInfo] = useState<FileShareInfo | { kind: "folder" } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/aindrive/links/${id}/sale`)
      .then((r) => (r.ok ? r.json() : { kind: "folder" }))
      .then((d: FileShareInfo | { kind: "folder" }) => alive && setFileInfo(d))
      .catch(() => alive && setFileInfo({ kind: "folder" }));
    return () => {
      alive = false;
    };
  }, [id, version]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/aindrive/links/${id}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setError(await errorOf(res, t("Not found")));
        setMeta((await res.json()) as DriveMeta);
      })
      .catch(() => alive && setError(t("Not found")));
    return () => {
      alive = false;
    };
  }, [id, t, version]);

  // where each page stands against the backup — re-read whenever the drive is
  useEffect(() => {
    let alive = true;
    fetch(`/api/aindrive/links/${id}/sync`)
      .then((r) => (r.ok ? r.json() : { pages: [] }))
      .then((d: { pages: SyncPage[] }) => alive && setSync(d.pages))
      .catch(() => alive && setSync([]));
    return () => {
      alive = false;
    };
  }, [id, version]);

  const managed = useMemo<Managed | undefined>(() => {
    if (!meta || !sync) return undefined;
    const prefix = `${meta.backupFolder}`;
    const files = new Map<string, { pageId: string; title: string; status: SyncState }>();
    for (const p of sync) if (p.path) files.set(p.path, { pageId: p.id, title: p.title, status: p.status });
    return { prefix, files };
  }, [meta, sync]);
  const counts = useMemo(() => {
    const c: Record<SyncState, number> = { synced: 0, pending: 0, failed: 0, excluded: 0 };
    for (const p of sync ?? []) c[p.status]++;
    return c;
  }, [sync]);

  // the first backup runs in the background after linking — follow it until it lands
  const pending = !!meta && !meta.drive.lastBackupAt;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(reload, 3_000);
    return () => clearInterval(timer);
  }, [pending, reload]);

  async function backupNow() {
    setBackingUp(true);
    const res = await fetch(`/api/aindrive/links/${id}/backup`, { method: "POST" });
    setBackingUp(false);
    if (!res.ok) setError(await errorOf(res, t("Could not sync")));
    else setError(null);
    reload();
  }

  async function unlink() {
    if (!window.confirm(t("Unlink this teamspace from aindrive? Syncing stops; files on the drive are not deleted.")))
      return;
    await fetch(`/api/aindrive/links/${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("aindrive:teamspace-changed"));
    router.push("/home");
  }

  if (error && !meta) return <p className="p-10 text-sm text-neutral-500">{error}</p>;
  if (!meta) return null;
  const d = meta.drive;
  const state = driveState(d);

  return <div data-testid="teamspace-drive" className="mx-auto max-w-5xl space-y-4 px-8 pb-16 pt-12">
    <AinuiText text={`${meta.teamspaceName} · ${d.name}`} />
    <AinuiText text={`aindrive · ${d.driveId}${d.root ? ` / ${d.root}` : ""}`} />
    {!d.backup && <AinuiText text={fileInfo?.kind === "file" ? t("A file {who} shared with the {ts} teamspace. Members can open and download it; it stays on {who}'s drive.", { who: meta.linkedBy ?? t("Members"), ts: meta.teamspaceName }) : t("An aindrive folder {who} shared with the {ts} teamspace. Any member can open and edit it; changes go straight to {who}'s drive.", { who: meta.linkedBy ?? t("Members"), ts: meta.teamspaceName })} />}
    {d.backup && <section data-testid="teamspace-drive-backup" data-state={state} className="space-y-3 rounded-xl border p-4">
      <AinuiText text={`${t("Linked")} · ${t(STATE_LABEL[state])}`} />
      <AinuiText text={pending ? t("First sync running…") : d.lastBackupError ? t("Last sync failed: {error}", { error: d.lastBackupError }) : t("Last sync {time} · {n} files", { time: new Date(d.lastBackupAt!).toLocaleString(), n: d.lastBackupFiles ?? 0 })} />
      <AinuiButton testId="teamspace-drive-backup-now" disabled={backingUp || !meta.available} onClick={backupNow} label={backingUp ? t("Syncing…") : t("Sync now")} />
      <AinuiText text={t("{ts}'s pages and databases sync as OKF to {folder}/ a few seconds after each edit. Press ‘Sync now’ to sync right away. Other files in the folder are left as they are and shown alongside.", { ts: meta.teamspaceName, folder: meta.backupFolder })} />
      {!!sync?.length && <>
        <AinuiButton testId="teamspace-drive-pages-toggle" label={`${t("{n} pages", { n: sync.length })} · ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${t(SYNC_LABEL[k as SyncState])} ${n}`).join(" · ")} · ${showPages ? t("Collapse") : t("Expand")}`} onClick={() => setShowPages((v) => !v)} />
        {showPages && <div data-testid="teamspace-drive-pages">{sync.map((p) => <AinuiButton key={p.id} label={`${p.title || t("Untitled")} · ${t(SYNC_LABEL[p.status])} · ${p.path || t("Private page — not synced")}`} onClick={() => router.push(`/p/${p.id}`)} />)}</div>}
      </>}
    </section>}
    {error && <p role="alert">{error}</p>}
    {fileInfo?.kind === "file" ? <FileShareCard linkId={id} driveId={d.driveId} path={d.root} info={fileInfo} onUnlocked={reload} /> : !fileInfo ? null : meta.available ?
      <Browser key={d.lastBackupAt ?? "none"} api={`/api/aindrive/links/${id}`} title={`${d.driveId}${d.root ? ` / ${d.root}` : ""}`} managed={d.backup ? managed : undefined} /> : <AinuiText text={t("This folder is no longer offered on this server.")} />}
    <AinuiButton label={t("Unlink")} onClick={unlink} />
  </div>;
}
