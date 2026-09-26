"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AinuiButton, AinuiForm, AinuiText, AinuiImage } from "@/components/ainui/surface";
import { useRouter, usePathname } from "next/navigation";
import QRCode from "qrcode";
import { Users } from "lucide-react";
import { useT } from "@/i18n/provider";

export interface FamilySummary {
  teamspace: { id: string; name: string; icon: string | null };
  members: {
    userId: string;
    name: string;
    me: boolean;
    connected: boolean;
    folders: { id: string; name: string; root: string; online: boolean; backup: boolean }[];
  }[];
  invites: { id: string; name: string; token: string; createdAt: string }[];
  backup: { id: string; name: string; lastBackupAt: string | null; error: string | null } | null;
}

/** Other parts of the page (the sidebar badge) refresh when this changes. */
export const FAMILY_CHANGED = "aindrive:teamspace-changed";
const OPEN_SHEET = "family:open-sheet";

/** Opens the family folders sheet for a teamspace from anywhere. */
export function openFamilySheet(teamspaceId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SHEET, { detail: teamspaceId }));
}

export function useFamily(teamspaceId: string | null | undefined) {
  const [data, setData] = useState<FamilySummary | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener(FAMILY_CHANGED, reload);
    return () => window.removeEventListener(FAMILY_CHANGED, reload);
  }, [reload]);
  useEffect(() => {
    if (!teamspaceId) return;
    let alive = true;
    fetch(`/api/teamspaces/${teamspaceId}/family`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FamilySummary | null) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [teamspaceId, version]);
  return { data: teamspaceId ? data : null, reload };
}

const inviteUrl = (token: string) => `${window.location.origin}/family/${token}`;

/**
 * "👪 Family folders 3/4" — in a teamspace page's header. Says at a glance how many
 * of the family have shared their phone here, and whether a phone is off.
 */
export function FamilyFoldersPill({ teamspaceId }: { teamspaceId: string | null | undefined }) {
  const t = useT();
  const { data } = useFamily(teamspaceId);
  if (!teamspaceId || !data) return null;
  const sharing = data.members.filter((m) => m.folders.length).length;
  const total = data.members.length + data.invites.length;
  const off = data.members.some((m) => m.folders.some((f) => !f.online));
  return <AinuiButton testId="family-folders-pill" label={`${t("Family folders {n}/{total}", { n: sharing, total })}${off ? ` · ${t("Offline")}` : ""}`} onClick={() => openFamilySheet(teamspaceId)} />;
}

/** Mounted once (app layout); opens on openFamilySheet(teamspaceId). */
export function FamilyFoldersHost() {
  const [teamspaceId, setTeamspaceId] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTeamspaceId((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_SHEET, on);
    return () => window.removeEventListener(OPEN_SHEET, on);
  }, []);
  if (!teamspaceId) return null;
  return createPortal(<FamilyFoldersSheet teamspaceId={teamspaceId} onClose={() => setTeamspaceId(null)} />, document.body);
}

function FamilyFoldersSheet({ teamspaceId, onClose }: { teamspaceId: string; onClose: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { data, reload } = useFamily(teamspaceId);
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function invite(values: Record<string, unknown>) {
    const name = String(values.name ?? "").trim();
    if (!name) throw new Error(t("Name"));
    setBusy(true);
    const r = await fetch(`/api/teamspaces/${teamspaceId}/family/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { invite?: { name: string; token: string }; error?: string } | undefined;
    setBusy(false);
    if (!r?.ok || !d?.invite) return setNote(d?.error ?? t("Couldn't create the invite link."));
    setMade(d.invite);
    reload();
  }

  async function backupNow() {
    if (!data?.backup) return;
    setSyncing(true);
    const r = await fetch(`/api/aindrive/links/${data.backup.id}/backup`, { method: "POST" }).catch(() => null);
    setSyncing(false);
    setNote(r?.ok ? t("Backed up.") : t("Backup failed."));
    window.dispatchEvent(new Event(FAMILY_CHANGED));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={t("Family folders")}
        data-testid="family-folders-sheet"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <Users size={16} className="text-neutral-500" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {data?.teamspace.icon ? `${data.teamspace.icon} ` : ""}
            {data?.teamspace.name ?? ""} · {t("Family folders")}
          </h2>
          <AinuiButton label={t("Close")} onClick={onClose} />
        </div>
        <p className="px-5 pt-3 text-xs text-neutral-500">
          {t("Folders each family member picks on their phone (aindrive) are shared here. Files stay on each phone; the family and the agent see them together.")}
        </p>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!data && <p className="text-sm text-neutral-400">{t("Loading…")}</p>}
          <div className="space-y-3">
            {data?.members.map((m) => <div key={m.userId} data-testid={`family-member-${m.name}`} className="rounded-lg border p-3">
              <AinuiText text={`${m.name}${m.me ? ` (${t("me")})` : ""} · ${!m.folders.length ? t("Hasn't shared a folder yet") : m.folders.every((f) => f.online) ? t("Connected · phone on") : t("Connected · phone off — can't be read right now")}`} />
              {m.folders.map((f) => <AinuiButton key={f.id} label={`${f.root || f.name}${f.backup ? ` · ${t("backup")}` : ""}`} onClick={() => { onClose(); router.push(`/aindrive/${f.id}`); }} />)}
              {m.me && <AinuiButton label={m.folders.length ? t("Share more") : t("Share my folders")} onClick={() => { onClose(); router.push(`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`); }} />}
            </div>)}
            {data?.invites.map((i) => <div key={i.id} data-testid={`family-invite-${i.name}`}>
              <AinuiText text={`${i.name} · ${t("Invited · waiting for approval")}`} />
              <AinuiButton label={t("Link · QR")} onClick={() => setMade({ name: i.name, token: i.token })} />
            </div>)}
          </div>
          {made ? <InviteCard name={made.name} token={made.token} onDone={() => setMade(null)} /> : <div className="mt-4">
            <AinuiText text={t("Invite family")} />
            <AinuiForm testId="family-invite-create" fields={[{ key: "name", label: t("Who's joining? (e.g. Grandpa)"), value: "" }]} disabled={busy} submitLabel={t("Create invite link")} onSubmit={invite} />
          </div>}
          {data?.backup && <div className="mt-4 rounded-lg border p-3">
            <AinuiText text={t("This space backs up to → {name}", { name: data.backup.name })} />
            <AinuiText text={data.backup.error ? t("Last backup failed") : data.backup.lastBackupAt ? t("Last backup {time}", { time: new Date(data.backup.lastBackupAt).toLocaleString() }) : t("Not backed up yet")} />
            <AinuiButton label={t("Back up now")} disabled={syncing} onClick={backupNow} />
          </div>}
          {note && <p className="mt-2 text-xs text-neutral-500">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function InviteCard({ name, token, onDone }: { name: string; token: string; onDone: () => void }) {
  const t = useT();
  const url = inviteUrl(token);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 220, margin: 1 })
      .then((d) => alive && setQr(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  const message = t("{name}, you're invited to our family space. Open this on your phone and tap approve: {url}", { name, url });
  return (
    <div data-testid="family-invite-card" className="mt-4 rounded-lg border border-neutral-200 p-4 text-center dark:border-neutral-700">
      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("Invite for {name}", { name })}</p>
      <p className="mb-3 text-[11px] text-neutral-500">{t("Scan the QR with a phone camera, or send the link by message.")}</p>
      {qr ? (
        <div data-testid="family-invite-qr" className="mx-auto h-44 w-44"><AinuiImage url={qr} /></div>
      ) : (
        <div className="mx-auto h-44 w-44 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      )}
      <p data-testid="family-invite-url" className="mt-3 break-all rounded bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {url}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <AinuiButton label={copied ? t("Copied it") : t("Copy message")} onClick={async () => { await navigator.clipboard?.writeText(message); setCopied(true); }} />
        {typeof navigator !== "undefined" && "share" in navigator && <AinuiButton label={t("Send")} onClick={() => navigator.share({ text: message }).catch(() => {})} />}
        <AinuiButton label={t("Close")} onClick={onDone} />
      </div>
    </div>
  );
}
