"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, FileText, HardDrive, Plus, RefreshCw } from "lucide-react";
import { LinkForm, errorOf, type Drive } from "@/components/home/aindrive-panel";
import { useT } from "@/i18n/provider";
import { AindriveAccountBadge, AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { loadAindriveInfo } from "@/lib/aindrive-client";

/**
 * A teamspace's aindrive sync, as the sidebar shows it.
 *
 * Linked: a status badge beside the name (click → what the sync is doing, and
 * 지금 동기화 right there) and a row that opens the folder. Not linked: the same
 * spots offer to connect — a faint icon on hover and an "aindrive에 동기화하기"
 * row — so how to start syncing is visible without knowing the 새로 추가 menu.
 * Pages announce a change with the `aindrive:teamspace-changed` window event.
 */

const CHANGED = "aindrive:teamspace-changed";

interface TsDrive {
  id: string;
  name: string;
  lastBackupAt?: string | null;
  lastBackupError?: string | null;
}

export type DriveState = "synced" | "syncing" | "failed";

/** One word for where the sync stands — the same word in every place it shows. */
export function driveState(d: Pick<TsDrive, "lastBackupAt" | "lastBackupError">): DriveState {
  if (d.lastBackupError) return "failed";
  return d.lastBackupAt ? "synced" : "syncing";
}

export const STATE_DOT: Record<DriveState, string> = {
  synced: "bg-emerald-500",
  syncing: "bg-amber-400",
  failed: "bg-red-500",
};
export const STATE_TEXT: Record<DriveState, string> = {
  synced: "text-emerald-600 dark:text-emerald-400",
  syncing: "text-amber-600 dark:text-amber-400",
  failed: "text-red-600 dark:text-red-400",
};
export const STATE_LABEL: Record<DriveState, string> = {
  synced: "동기화됨",
  syncing: "동기화 중",
  failed: "동기화 실패",
};

// status drifts as syncs run after edits — re-read it now and then
const POLL_MS = 30_000;

function useTeamspaceDrive(teamspaceId: string) {
  const [drive, setDrive] = useState<TsDrive | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    const timer = setInterval(reload, POLL_MS);
    return () => {
      window.removeEventListener(CHANGED, reload);
      clearInterval(timer);
    };
  }, [reload]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/teamspaces/${teamspaceId}/drives`)
      .then((r) => (r.ok ? r.json() : { drives: [] }))
      .then((d: { drives: TsDrive[] }) => alive && setDrive(d.drives[0] ?? null))
      .catch(() => alive && setDrive(null));
    return () => {
      alive = false;
    };
  }, [teamspaceId, version]);
  return drive;
}

function ago(iso: string, t: ReturnType<typeof useT>): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return t("방금 전");
  if (m < 60) return t("{n}분 전", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? t("{n}시간 전", { n: h }) : new Date(iso).toLocaleString();
}

/** Closes on a click outside the returned ref, or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** The connect dialog, opened from any of the sidebar's "connect" affordances. */
function useLinkDialog(teamspaceId: string) {
  const t = useT();
  const router = useRouter();
  // null = closed; otherwise the person's aindrive as last loaded
  const [state, setState] = useState<{ connected: boolean; drives: Drive[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => setState(null);

  // this person's own drives (their connected aindrive account), each with
  // whether its CLI is connected right now
  async function load(): Promise<boolean> {
    const d = await loadAindriveInfo(true);
    if (!d.configured) {
      setError(t("이 서버에는 aindrive가 설정되어 있지 않습니다."));
      return false;
    }
    setState({ connected: d.connected, drives: d.drives });
    return true;
  }

  async function open() {
    setError(null);
    await load();
  }

  const drives = state?.drives ?? [];
  // portalled out of the sidebar: inside it the overlay is clipped to the
  // sidebar's box and swallows the clicks meant for the dialog
  const dialog = state && createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("aindrive에 동기화하기")}
        data-testid="teamspace-aindrive-dialog"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
          <HardDrive size={16} className="text-neutral-400" /> {t("aindrive에 동기화하기")}
        </h2>
        <ol className="mb-4 list-decimal space-y-0.5 pl-5 text-xs text-neutral-500">
          <li>{t("이 팀스페이스의 페이지와 데이터베이스가 고른 폴더에 OKF 형식으로 복사됩니다.")}</li>
          <li>{t("그다음부터는 페이지를 편집할 때마다 자동으로 동기화됩니다.")}</li>
          <li>{t("폴더에 원래 있던 파일은 그대로 두고, 사이드바의 aindrive에서 함께 볼 수 있습니다.")}</li>
        </ol>
        {!state.connected ? (
          <AindriveConnect onConnected={() => void load()} />
        ) : (
        <LinkForm
          // re-mount on refresh so the default pick follows what is online now
          key={drives.map((d) => `${d.id}:${d.online}`).join(",")}
          drives={drives}
          accountBadge={<AindriveAccountBadge />}
          onRefresh={async () => {
            await load();
          }}
          withName
          onCancel={close}
          submit={async (body) => {
            const res = await fetch(`/api/teamspaces/${teamspaceId}/drives`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) return errorOf(res, t("연결할 수 없습니다"));
            const { drive: created } = (await res.json()) as { drive: TsDrive };
            close();
            window.dispatchEvent(new Event(CHANGED));
            router.push(`/aindrive/${created.id}`);
            return null;
          }}
        />
        )}
      </div>
    </div>,
    document.body
  );

  return { open, dialog, error };
}

/** Beside the teamspace's name. Linked: a status dot that opens a small status
 *  card with 지금 동기화. Not linked: a faint connect icon on hover. */
export function TeamspaceDriveBadge({ teamspaceId }: { teamspaceId: string }) {
  const t = useT();
  const drive = useTeamspaceDrive(teamspaceId);
  const link = useLinkDialog(teamspaceId);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // where the card opens: fixed, measured from the badge and kept on screen —
  // the badge sits at the sidebar's right edge, so a card anchored to it
  // overflows the window's left edge
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);

  if (drive === undefined) return null;
  if (drive === null) {
    return (
      <>
        <button
          data-testid={`teamspace-drive-connect-icon-${teamspaceId}`}
          onClick={() => void link.open()}
          aria-label={t("aindrive에 동기화하기")}
          title={t("aindrive에 동기화하기")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-300/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/row:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-700"
        >
          <HardDrive size={13} />
        </button>
        {link.dialog}
      </>
    );
  }

  const current = drive;
  const state = syncing ? "syncing" : driveState(current);
  const label = `aindrive · ${t(STATE_LABEL[state])}`;

  async function syncNow() {
    setSyncing(true);
    setResult(null);
    const res = await fetch(`/api/aindrive/links/${current.id}/backup`, { method: "POST" });
    const r = (await res.json().catch(() => ({}))) as { written?: number; deleted?: number; error?: string };
    setSyncing(false);
    setResult(
      res.ok
        ? t("동기화했습니다 · 바뀐 파일 {n}개", { n: (r.written ?? 0) + (r.deleted ?? 0) })
        : t("동기화 실패: {error}", { error: r.error ?? res.statusText })
    );
    window.dispatchEvent(new Event(CHANGED));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid={`teamspace-drive-badge-${teamspaceId}`}
        data-state={state}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={(e) => {
          setResult(null);
          const r = e.currentTarget.getBoundingClientRect();
          const width = 256;
          setPos({
            top: r.bottom + 6,
            left: Math.max(8, Math.min(r.left - 12, window.innerWidth - width - 8)),
          });
          setOpen((v) => !v);
        }}
        className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-600 dark:hover:bg-neutral-700 ${
          open ? "bg-neutral-300/60 text-neutral-700 dark:bg-neutral-700" : ""
        }`}
      >
        <HardDrive size={13} />
        <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white dark:ring-neutral-900 ${STATE_DOT[state]}`} />
      </button>
      {open && pos && (
        <div
          role="dialog"
          aria-label={label}
          data-testid={`teamspace-drive-popover-${teamspaceId}`}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-64 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="mb-2 flex items-center gap-2">
            <HardDrive size={14} className="text-neutral-400" />
            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">aindrive</span>
            <span className={`ml-auto flex items-center gap-1 text-xs ${STATE_TEXT[state]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} />
              {t(STATE_LABEL[state])}
            </span>
          </div>
          <p className="text-xs text-neutral-500">{t("페이지를 편집하면 몇 초 뒤 자동으로 동기화됩니다.")}</p>
          <p data-testid={`teamspace-drive-popover-status-${teamspaceId}`} className="mt-1 text-xs text-neutral-400">
            {result ??
              (current.lastBackupError
                ? t("동기화 실패: {error}", { error: current.lastBackupError })
                : current.lastBackupAt
                  ? t("마지막 동기화 {when}", { when: ago(current.lastBackupAt, t) })
                  : t("첫 동기화 중…"))}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              data-testid={`teamspace-drive-sync-now-${teamspaceId}`}
              onClick={() => void syncNow()}
              disabled={syncing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-neutral-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? t("동기화 중…") : t("지금 동기화")}
            </button>
            <Link
              data-testid={`teamspace-drive-open-${teamspaceId}`}
              href={`/aindrive/${current.id}`}
              onClick={close}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {t("aindrive 열기")} <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** First under the teamspace. Linked: opens the folder, with the sync state.
 *  Not linked: the way to start syncing, where it can be seen. */
export function TeamspaceDriveRow({ teamspaceId }: { teamspaceId: string }) {
  const t = useT();
  const drive = useTeamspaceDrive(teamspaceId);
  const link = useLinkDialog(teamspaceId);
  const pathname = usePathname();
  if (drive === undefined) return null;
  if (drive === null) {
    return (
      <>
        <button
          data-testid={`teamspace-drive-connect-row-${teamspaceId}`}
          onClick={() => void link.open()}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800"
          style={{ paddingLeft: "36px" }}
        >
          <HardDrive size={14} className="shrink-0" />
          <span className="truncate">{t("aindrive에 동기화하기")}</span>
        </button>
        {link.error && (
          <p className="py-1 pr-2 text-xs text-red-600" style={{ paddingLeft: "36px" }}>
            {link.error}
          </p>
        )}
        {link.dialog}
      </>
    );
  }
  const active = pathname === `/aindrive/${drive.id}`;
  const state = driveState(drive);
  return (
    <Link
      data-testid={`teamspace-drive-row-${teamspaceId}`}
      data-state={state}
      href={`/aindrive/${drive.id}`}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-sm transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800 ${
        active ? "bg-neutral-200/60 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"
      }`}
      style={{ paddingLeft: "36px" }}
    >
      <HardDrive size={14} className="shrink-0 text-neutral-400" />
      <span className="truncate">aindrive</span>
      <span className={`ml-auto flex shrink-0 items-center gap-1 text-[11px] ${STATE_TEXT[state]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} />
        {t(STATE_LABEL[state])}
      </span>
    </Link>
  );
}

/** 새로 추가: a page, or — while the teamspace has none — an aindrive sync. */
export function TeamspaceAddRow({ teamspaceId, onAddPage }: { teamspaceId: string; onAddPage: () => void }) {
  const t = useT();
  const drive = useTeamspaceDrive(teamspaceId);
  const link = useLinkDialog(teamspaceId);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, close);

  return (
    <div className="relative" ref={menuRef}>
      <button
        data-testid={`teamspace-add-row-${teamspaceId}`}
        onClick={() => setMenu((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800"
        style={{ paddingLeft: "36px" }}
      >
        <Plus size={14} className="shrink-0" />
        {t("새로 추가")}
      </button>
      {menu && (
        <div
          role="menu"
          data-testid={`teamspace-add-menu-${teamspaceId}`}
          className="absolute left-8 z-40 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <button
            role="menuitem"
            data-testid={`teamspace-add-page-item-${teamspaceId}`}
            onClick={() => {
              setMenu(false);
              onAddPage();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <FileText size={14} className="text-neutral-400" /> {t("페이지")}
          </button>
          {drive === null && (
            <button
              role="menuitem"
              data-testid={`teamspace-add-aindrive-${teamspaceId}`}
              onClick={() => {
                setMenu(false);
                void link.open();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <HardDrive size={14} className="text-neutral-400" />
              <span>
                {t("aindrive에 동기화하기")}
                <span className="block text-[11px] text-neutral-400">{t("이 팀스페이스를 OKF로 백업")}</span>
              </span>
            </button>
          )}
        </div>
      )}
      {link.error && (
        <p className="px-2 py-1 text-xs text-red-600" style={{ paddingLeft: "36px" }}>
          {link.error}
        </p>
      )}
      {link.dialog}
    </div>
  );
}
