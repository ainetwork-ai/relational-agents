"use client";

import { useEffect, useState } from "react";
import { ChevronRight, File, Folder, HardDrive, X } from "lucide-react";
import { loadAindriveInfo, type AindriveInfo } from "@/lib/aindrive-client";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { useT } from "@/i18n/provider";
import { AindriveAccountBadge, AindriveConnect } from "./aindrive-connect";

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
}

function fmtSize(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "aindrive에서 가져오기": pick a file from the aindrive folders offered here.
 * Nothing is uploaded — the block gets the file's aindrive link, and the
 * preview reads the file from the drive whenever the page is opened.
 */
export function AindrivePicker({
  onPick,
  onClose,
}: {
  onPick: (file: { url: string; name: string }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [info, setInfo] = useState<AindriveInfo | null>(null);
  const [driveId, setDriveId] = useState<string>("");
  const [dir, setDir] = useState<string>("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadAindriveInfo().then((i) => {
      if (!alive) return;
      setInfo(i);
      const first = i.drives.find((d) => d.online !== false) ?? i.drives[0];
      if (first) {
        setDriveId(first.id);
        setDir(first.root);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!driveId) return;
    let alive = true;
    fetch(`/api/aindrive/browse?${new URLSearchParams({ drive: driveId, path: dir })}`)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { entries?: Entry[]; error?: string };
        if (!alive) return;
        if (!r.ok) {
          setEntries([]);
          setError(d.error ?? t("폴더를 읽을 수 없습니다"));
        } else {
          setError(null);
          setEntries(d.entries ?? []);
        }
      })
      .catch(() => alive && setError(t("폴더를 읽을 수 없습니다")));
    return () => {
      alive = false;
    };
  }, [driveId, dir, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const drive = info?.drives.find((d) => d.id === driveId);
  const rootDir = drive?.root ?? "";
  // breadcrumbs start at the offered folder — nothing above it can be opened
  const crumbs = dir.slice(rootDir.length).split("/").filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("aindrive에서 가져오기")}
        data-testid="aindrive-picker"
        className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <HardDrive size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold">{t("aindrive에서 가져오기")}</h2>
          {info && info.drives.length > 1 && (
            <select
              data-testid="aindrive-picker-drive"
              value={driveId}
              onChange={(e) => {
                const d = info.drives.find((x) => x.id === e.target.value);
                setDriveId(e.target.value);
                setDir(d?.root ?? "");
              }}
              className="ml-2 rounded border border-neutral-200 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
            >
              {info.drives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={onClose} aria-label={t("닫기")} className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <X size={16} />
          </button>
        </div>
        {info?.connected && (
          <div className="px-4 pt-2">
            <AindriveAccountBadge />
          </div>
        )}
        <p className="px-4 pt-1 text-[11px] text-neutral-400">
          {t("파일을 복사하지 않고 링크로 넣습니다. 드라이브의 파일이 바뀌면 미리보기도 바뀝니다.")}
        </p>

        {info && info.configured && !info.connected ? (
          <div className="p-4">
            <AindriveConnect
              onConnected={() =>
                void loadAindriveInfo(true).then((i) => {
                  setInfo(i);
                  const first = i.drives.find((d) => d.online !== false) ?? i.drives[0];
                  if (first) {
                    setDriveId(first.id);
                    setDir(first.root);
                  }
                })
              }
            />
          </div>
        ) : info && !info.configured ? (
          <p className="p-4 text-sm text-neutral-500">{t("이 서버에는 aindrive가 설정되어 있지 않습니다.")}</p>
        ) : info && info.drives.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">{t("가져올 수 있는 aindrive 폴더가 없습니다.")}</p>
        ) : (
          <>
            <nav className="flex flex-wrap items-center gap-0.5 px-4 py-2 text-xs text-neutral-500">
              <button data-testid="aindrive-picker-crumb-root" onClick={() => setDir(rootDir)} className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {drive?.name ?? "aindrive"}
                {rootDir ? ` / ${rootDir}` : ""}
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <ChevronRight size={12} />
                  <button
                    onClick={() => setDir([rootDir, ...crumbs.slice(0, i + 1)].filter(Boolean).join("/"))}
                    className="rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {c}
                  </button>
                </span>
              ))}
            </nav>
            <ul data-testid="aindrive-picker-list" className="min-h-[12rem] flex-1 overflow-y-auto px-2 pb-3">
              {entries === null && <li className="px-2 py-2 text-xs text-neutral-400">{t("불러오는 중…")}</li>}
              {error && <li className="px-2 py-2 text-xs text-red-600">{error}</li>}
              {entries && !error && entries.length === 0 && (
                <li className="px-2 py-2 text-xs text-neutral-400">{t("빈 폴더입니다")}</li>
              )}
              {entries?.map((e) => {
                const path = dir ? `${dir}/${e.name}` : e.name;
                return (
                  <li key={e.name}>
                    <button
                      data-testid={`aindrive-picker-entry-${e.name}`}
                      onClick={() => {
                        if (e.isDir) return setDir(path);
                        if (!info?.base) return setError(t("aindrive 주소를 알 수 없습니다"));
                        onPick({ url: aindriveFileUrl(info.base, { driveId, path }), name: e.name });
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      {e.isDir ? (
                        <Folder size={15} className="shrink-0 text-neutral-400" />
                      ) : (
                        <File size={15} className="shrink-0 text-neutral-400" />
                      )}
                      <span className="truncate text-neutral-700 dark:text-neutral-200">{e.name}</span>
                      {e.isDir ? (
                        <ChevronRight size={14} className="ml-auto shrink-0 text-neutral-300" />
                      ) : (
                        <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{fmtSize(e.size)}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
