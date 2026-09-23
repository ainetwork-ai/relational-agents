"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, HardDrive } from "lucide-react";
import { Browser, errorOf } from "@/components/home/aindrive-panel";
import { useT } from "@/i18n/provider";

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
    if (!res.ok) setError(await errorOf(res, t("백업할 수 없습니다")));
    else setError(null);
    reload();
  }

  async function unlink() {
    if (!window.confirm(t("이 팀스페이스의 aindrive 연결을 해제할까요? 백업이 멈추고, 드라이브의 파일은 지워지지 않습니다.")))
      return;
    await fetch(`/api/aindrive/links/${id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("aindrive:teamspace-changed"));
    router.push("/home");
  }

  if (error && !meta) return <p className="p-10 text-sm text-neutral-500">{error}</p>;
  if (!meta) return null;
  const d = meta.drive;

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

      <div
        data-testid="teamspace-drive-backup"
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-700"
      >
        <CloudUpload size={16} className="text-neutral-400" />
        <span className="text-neutral-600 dark:text-neutral-300">
          {t("{ts}의 페이지와 데이터베이스가 OKF로 {folder}/ 에 백업됩니다.", {
            ts: meta.teamspaceName,
            folder: meta.backupFolder,
          })}
        </span>
        <span data-testid="teamspace-drive-backup-status" className="text-xs text-neutral-400">
          {pending
            ? t("첫 백업 중…")
            : d.lastBackupError
              ? t("마지막 백업 실패: {error}", { error: d.lastBackupError })
              : t("마지막 백업 {time} · 파일 {n}개", {
                  time: new Date(d.lastBackupAt!).toLocaleString(),
                  n: d.lastBackupFiles ?? 0,
                })}
        </span>
        <button
          data-testid="teamspace-drive-backup-now"
          onClick={() => void backupNow()}
          disabled={backingUp || !meta.available}
          className="ml-auto rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {backingUp ? t("백업 중…") : t("지금 백업")}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {meta.available ? (
        <Browser
          // a finished backup changes what is in the folder — re-read the tree
          key={d.lastBackupAt ?? "none"}
          api={`/api/aindrive/links/${id}`}
          title={`${d.driveId}${d.root ? ` / ${d.root}` : ""}`}
          onUnlink={() => void unlink()}
        />
      ) : (
        <p className="text-sm text-neutral-500">{t("이 폴더는 이 서버에서 더 이상 제공되지 않습니다.")}</p>
      )}
    </div>
  );
}
