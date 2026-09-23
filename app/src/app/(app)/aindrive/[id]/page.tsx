"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudUpload, HardDrive } from "lucide-react";
import { Browser, errorOf, SYNC_DOT, SYNC_LABEL, type Managed, type SyncState } from "@/components/home/aindrive-panel";
import { STATE_DOT, STATE_LABEL, STATE_TEXT, driveState } from "@/components/sidebar/teamspace-drive";
import { useT } from "@/i18n/provider";

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
  };
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

  useEffect(() => {
    let alive = true;
    fetch(`/api/aindrive/links/${id}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setError(await errorOf(res, t("찾을 수 없습니다")));
        setMeta((await res.json()) as DriveMeta);
      })
      .catch(() => alive && setError(t("찾을 수 없습니다")));
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
    if (!res.ok) setError(await errorOf(res, t("동기화할 수 없습니다")));
    else setError(null);
    reload();
  }

  async function unlink() {
    if (!window.confirm(t("이 팀스페이스의 aindrive 연결을 해제할까요? 동기화가 멈추고, 드라이브의 파일은 지워지지 않습니다.")))
      return;
    await fetch(`/api/aindrive/links/${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("aindrive:teamspace-changed"));
    router.push("/home");
  }

  if (error && !meta) return <p className="p-10 text-sm text-neutral-500">{error}</p>;
  if (!meta) return null;
  const d = meta.drive;
  const state = driveState(d);

  return (
    <div data-testid="teamspace-drive" className="mx-auto max-w-5xl px-8 pb-16 pt-12">
      <p className="mb-1 text-xs text-neutral-400">{meta.teamspaceName}</p>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        <HardDrive size={22} className="text-neutral-400" /> {d.name}
      </h1>
      <p className="mb-6 font-mono text-xs text-neutral-400">
        aindrive · {d.driveId}
        {d.root ? ` / ${d.root}` : ""}
      </p>

      {/* 1. the connection itself — is this teamspace linked, and is it current */}
      <section
        data-testid="teamspace-drive-backup"
        data-state={state}
        className="mb-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-testid="teamspace-drive-state"
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATE_TEXT[state]} ${
              state === "synced"
                ? "bg-emerald-50 dark:bg-emerald-950/40"
                : state === "failed"
                  ? "bg-red-50 dark:bg-red-950/40"
                  : "bg-amber-50 dark:bg-amber-950/40"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} />
            {t("연동됨")} · {t(STATE_LABEL[state])}
          </span>
          <span data-testid="teamspace-drive-backup-status" className="text-xs text-neutral-500">
            {pending
              ? t("첫 동기화 중…")
              : d.lastBackupError
                ? t("마지막 동기화 실패: {error}", { error: d.lastBackupError })
                : t("마지막 동기화 {time} · 파일 {n}개", {
                    time: new Date(d.lastBackupAt!).toLocaleString(),
                    n: d.lastBackupFiles ?? 0,
                  })}
          </span>
          <button
            data-testid="teamspace-drive-backup-now"
            onClick={() => void backupNow()}
            disabled={backingUp || !meta.available}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <CloudUpload size={14} /> {backingUp ? t("동기화 중…") : t("지금 동기화")}
          </button>
        </div>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
          {t("{ts}의 페이지와 데이터베이스는 편집할 때마다 몇 초 뒤 OKF 형식으로 {folder}/ 에 자동 동기화됩니다. 바로 반영하려면 ‘지금 동기화’를 누르세요. 같은 폴더의 다른 파일은 그대로 두고 함께 보여줍니다.", {
            ts: meta.teamspaceName,
            folder: meta.backupFolder,
          })}
        </p>

        {/* 2. what is and isn't backed up, per page */}
        {sync && sync.length > 0 && (
          <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <button
              data-testid="teamspace-drive-pages-toggle"
              onClick={() => setShowPages((v) => !v)}
              className="flex w-full flex-wrap items-center gap-3 text-left text-xs text-neutral-500"
            >
              <span className="font-medium text-neutral-700 dark:text-neutral-200">{t("페이지 {n}개", { n: sync.length })}</span>
              {(["synced", "pending", "failed", "excluded"] as SyncState[])
                .filter((k) => counts[k] > 0)
                .map((k) => (
                  <span key={k} data-testid={`teamspace-drive-count-${k}`} className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${SYNC_DOT[k]}`} />
                    {t(SYNC_LABEL[k])} {counts[k]}
                  </span>
                ))}
              <span className="ml-auto text-neutral-400">{showPages ? t("접기") : t("펼치기")}</span>
            </button>
            {showPages && (
              <ul data-testid="teamspace-drive-pages" className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
                {sync.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SYNC_DOT[p.status]}`} />
                    <Link href={`/p/${p.id}`} className="truncate text-neutral-700 hover:underline dark:text-neutral-200">
                      {p.icon ? `${p.icon} ` : ""}
                      {p.title || t("제목 없음")}
                    </Link>
                    <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-neutral-400">
                      {p.path ? p.path.slice(meta.backupFolder.length + 1) : t("비공개 페이지라 동기화하지 않습니다")}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-neutral-500">{t(SYNC_LABEL[p.status])}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* 3. the folder: the backup and the drive's own files, told apart */}
      {meta.available ? (
        <Browser
          // a finished backup changes what is in the folder — re-read the tree
          key={d.lastBackupAt ?? "none"}
          api={`/api/aindrive/links/${id}`}
          title={`${d.driveId}${d.root ? ` / ${d.root}` : ""}`}
          onUnlink={() => void unlink()}
          managed={managed}
        />
      ) : (
        <p className="text-sm text-neutral-500">{t("이 폴더는 이 서버에서 더 이상 제공되지 않습니다.")}</p>
      )}
    </div>
  );
}
