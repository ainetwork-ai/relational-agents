"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AinuiText } from "@/components/ainui/surface";
import { AinuiNavItem } from "@/components/ainui/navigation";
import { usePathname, useRouter } from "next/navigation";
import { FileText, HardDrive, Plus, Users } from "lucide-react";
import { LinkForm, errorOf, type Drive } from "@/components/home/aindrive-panel";
import { useT } from "@/i18n/provider";
import { openFamilySheet } from "@/components/family/family-folders";
import { AindriveAccountBadge, AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { loadAindriveInfo } from "@/lib/aindrive-client";

/**
 * A teamspace's aindrive sync, as the sidebar shows it.
 *
 * Linked: a status badge beside the name (click → what the sync is doing, and
 * Sync now right there) and a row that opens the folder. Not linked: the same
 * spots offer to connect — a faint icon on hover and a "Sync to aindrive"
 * row — so how to start syncing is visible without knowing the Add new menu.
 * Pages announce a change with the `aindrive:teamspace-changed` window event.
 */

const CHANGED = "aindrive:teamspace-changed";

interface TsDrive {
  id: string;
  name: string;
  lastBackupAt?: string | null;
  lastBackupError?: string | null;
  /** receives the teamspace's OKF backup */
  backup?: boolean;
  /** who linked it (their folder, shared with the teamspace) */
  linkedBy?: string | null;
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
  synced: "Synced",
  syncing: "Syncing",
  failed: "Sync failed",
};

// status drifts as syncs run after edits — re-read it now and then
const POLL_MS = 30_000;

/** Every folder linked into the teamspace (undefined while loading). */
function useTeamspaceDrives(teamspaceId: string) {
  const [drives, setDrives] = useState<TsDrive[] | undefined>(undefined);
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
      .then((d: { drives: TsDrive[] }) => alive && setDrives(d.drives))
      .catch(() => alive && setDrives([]));
    return () => {
      alive = false;
    };
  }, [teamspaceId, version]);
  return drives;
}

/** The link that receives the teamspace's sync (null = none linked yet). */
function useTeamspaceDrive(teamspaceId: string) {
  const drives = useTeamspaceDrives(teamspaceId);
  if (drives === undefined) return undefined;
  return drives.find((d) => d.backup) ?? drives[0] ?? null;
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
      setError(t("aindrive is not configured on this server."));
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
        aria-label={t("Sync to aindrive")}
        data-testid="teamspace-aindrive-dialog"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
          <HardDrive size={16} className="text-neutral-400" /> {t("Sync to aindrive")}
        </h2>
        <ol className="mb-4 list-decimal space-y-0.5 pl-5 text-xs text-neutral-500">
          <li>{t("This teamspace's pages and databases are copied to the folder you pick, in OKF format.")}</li>
          <li>{t("After that, every edit syncs automatically.")}</li>
          <li>{t("Files already in the folder stay as they are; browse them from aindrive in the sidebar.")}</li>
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
            if (!res.ok) return errorOf(res, t("Could not link"));
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
 *  card with Sync now. Not linked: a faint connect icon on hover. */
/** Beside the teamspace's name: the family's folders at a glance (a dot for
 *  their state) — it opens the family folders sheet, where members, their
 *  phones, invites and the backup all live. */
export function TeamspaceDriveBadge({ teamspaceId }: { teamspaceId: string }) {
  const t = useT();
  const drive = useTeamspaceDrive(teamspaceId);
  if (drive === undefined) return null;
  const state = drive ? driveState(drive) : null;
  const label = t("Family folders");
  return <div data-testid={`teamspace-drive-badge-${teamspaceId}`} data-state={state ?? "none"}>
    <AinuiNavItem size="icon" icon={Users} label={label} status={state ?? undefined} title={`${label}${state ? ` · ${t(STATE_LABEL[state])}` : ""}`} onClick={() => openFamilySheet(teamspaceId)} />
  </div>;
}

/** First under the teamspace: every folder linked into it — each member's
 *  own, labelled with who linked it — and, while there is none, the way to
 *  start syncing. */
export function TeamspaceDriveRow({ teamspaceId }: { teamspaceId: string }) {
  const t = useT();
  const drives = useTeamspaceDrives(teamspaceId);
  const link = useLinkDialog(teamspaceId);
  const pathname = usePathname();
  const router = useRouter();
  if (drives === undefined) return null;
  return <div className="min-w-0 pl-8">
    {!drives.length && <AinuiNavItem icon={HardDrive} testId={`teamspace-drive-connect-row-${teamspaceId}`} label={t("Sync to aindrive")} onClick={link.open} />}
    {drives.map((drive) => <div key={drive.id} data-testid={`teamspace-drive-row-${teamspaceId}`} data-drive={drive.id} data-state={drive.backup ? driveState(drive) : "linked"}>
      <AinuiNavItem icon={HardDrive} label={drive.name} active={pathname === `/aindrive/${drive.id}`} status={drive.backup ? driveState(drive) : undefined} title={`${drive.name} · ${drive.backup ? t(STATE_LABEL[driveState(drive)]) : drive.linkedBy ?? ""}`} onClick={() => router.push(`/aindrive/${drive.id}`)} />
    </div>)}
    {link.error && <AinuiText text={link.error} />}
    {link.dialog}
  </div>;
}

/** Add new: a page, or — while the teamspace has none — an aindrive sync. */
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
        {t("Add new")}
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
            <FileText size={14} className="text-neutral-400" /> {t("Page")}
          </button>
          {drive !== undefined && (
            <AinuiNavItem icon={HardDrive} testId={`teamspace-add-aindrive-${teamspaceId}`} label={drive ? t("Add an aindrive folder") : t("Sync to aindrive")} onClick={() => { setMenu(false); return link.open(); }} />
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
