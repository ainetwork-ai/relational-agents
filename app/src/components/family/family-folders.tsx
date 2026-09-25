"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { Copy, HardDrive, QrCode, RefreshCw, Send, UserPlus, Users, X } from "lucide-react";
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

const initial = (name: string) => name.trim().slice(0, 1) || "?";
const inviteUrl = (token: string) => `${window.location.origin}/family/${token}`;

/**
 * "👪 가족 폴더 3/4" — in a teamspace page's header. Says at a glance how many
 * of the family have shared their phone here, and whether a phone is off.
 */
export function FamilyFoldersPill({ teamspaceId }: { teamspaceId: string | null | undefined }) {
  const t = useT();
  const { data } = useFamily(teamspaceId);
  if (!teamspaceId || !data) return null;
  const sharing = data.members.filter((m) => m.folders.length).length;
  const total = data.members.length + data.invites.length;
  const off = data.members.some((m) => m.folders.some((f) => !f.online));
  return (
    <button
      data-testid="family-folders-pill"
      onClick={() => openFamilySheet(teamspaceId)}
      title={t("가족 폴더")}
      className="mr-1 flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Users size={12} />
      {t("가족 폴더 {n}/{total}", { n: sharing, total })}
      <span className={`h-1.5 w-1.5 rounded-full ${off ? "bg-amber-400" : sharing ? "bg-emerald-500" : "bg-neutral-300"}`} />
    </button>
  );
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
  const { data, reload } = useFamily(teamspaceId);
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function invite() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/teamspaces/${teamspaceId}/family/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { invite?: { name: string; token: string }; error?: string } | undefined;
    setBusy(false);
    if (!r?.ok || !d?.invite) return setNote(d?.error ?? t("초대 링크를 만들지 못했어요."));
    setMade(d.invite);
    setName("");
    reload();
  }

  async function backupNow() {
    if (!data?.backup) return;
    setSyncing(true);
    const r = await fetch(`/api/aindrive/links/${data.backup.id}/backup`, { method: "POST" }).catch(() => null);
    setSyncing(false);
    setNote(r?.ok ? t("백업했어요.") : t("백업하지 못했어요."));
    window.dispatchEvent(new Event(FAMILY_CHANGED));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={t("가족 폴더")}
        data-testid="family-folders-sheet"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <Users size={16} className="text-neutral-500" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {data?.teamspace.icon ? `${data.teamspace.icon} ` : ""}
            {data?.teamspace.name ?? ""} · {t("가족 폴더")}
          </h2>
          <button onClick={onClose} aria-label={t("닫기")} className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <X size={16} />
          </button>
        </div>
        <p className="px-5 pt-3 text-xs text-neutral-500">
          {t("가족 각자의 폰(aindrive)에서 고른 폴더가 이 공간에 공유돼요. 파일은 각자의 폰에 그대로 있고, 에이전트와 가족이 함께 봐요.")}
        </p>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!data && <p className="text-sm text-neutral-400">{t("불러오는 중…")}</p>}
          <ul className="space-y-2">
            {data?.members.map((m) => {
              const on = m.folders.filter((f) => f.online).length;
              const status = !m.folders.length
                ? { dot: "bg-neutral-300", text: t("아직 폴더를 공유하지 않았어요") }
                : on === m.folders.length
                  ? { dot: "bg-emerald-500", text: t("연결됨 · 폰 켜짐") }
                  : { dot: "bg-amber-400", text: t("연결됨 · 폰 꺼짐 — 지금은 읽을 수 없어요") };
              return (
                <li key={m.userId} data-testid={`family-member-${m.name}`} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {initial(m.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                        {m.name}
                        {m.me && <span className="ml-1 text-xs font-normal text-neutral-400">({t("나")})</span>}
                      </p>
                      <p className="flex items-center gap-1 text-[11px] text-neutral-500">
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} /> {status.text}
                      </p>
                    </div>
                    {m.me && (
                      <Link
                        href={`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`}
                        onClick={onClose}
                        className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {m.folders.length ? t("폴더 더 공유") : t("내 폴더 공유하기")}
                      </Link>
                    )}
                  </div>
                  {m.folders.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 pl-10">
                      {m.folders.map((f) => (
                        <span
                          key={f.id}
                          className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        >
                          <HardDrive size={10} className="text-neutral-400" />
                          {f.root || f.name}
                          {f.backup && <span className="text-[10px] text-blue-600 dark:text-blue-400">· {t("백업")}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
            {data?.invites.map((i) => (
              <li key={i.id} data-testid={`family-invite-${i.name}`} className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-neutral-300 text-sm text-neutral-400">
                    {initial(i.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-700 dark:text-neutral-200">{i.name}</p>
                    <p className="text-[11px] text-neutral-500">○ {t("초대함 · 승인 기다리는 중")}</p>
                  </div>
                  <button
                    onClick={() => setMade({ name: i.name, token: i.token })}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
                  >
                    <QrCode size={11} /> {t("링크·QR")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {made ? (
            <InviteCard name={made.name} token={made.token} onDone={() => setMade(null)} />
          ) : (
            <div className="mt-4 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                <UserPlus size={14} /> {t("가족 초대하기")}
              </p>
              <p className="mb-2 text-[11px] text-neutral-500">
                {t("링크나 QR을 받은 가족이 폰에서 한 번 승인하고, 공유할 폴더만 고르면 끝이에요.")}
              </p>
              <div className="flex gap-2">
                <input
                  data-testid="family-invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void invite()}
                  placeholder={t("누구를 초대할까요? (예: 외할아버지)")}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <button
                  data-testid="family-invite-create"
                  onClick={() => void invite()}
                  disabled={busy || !name.trim()}
                  className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {t("초대 링크 만들기")}
                </button>
              </div>
            </div>
          )}

          {data?.backup && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
              <HardDrive size={13} className="text-neutral-400" />
              <span className="min-w-0 flex-1">
                {t("이 공간 백업 → {name}", { name: data.backup.name })}
                <span className="block text-[11px] text-neutral-400">
                  {data.backup.error
                    ? t("마지막 백업 실패")
                    : data.backup.lastBackupAt
                      ? t("마지막 백업 {time}", { time: new Date(data.backup.lastBackupAt).toLocaleString() })
                      : t("아직 백업 전")}
                </span>
              </span>
              <button
                onClick={() => void backupNow()}
                disabled={syncing}
                className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={11} className={syncing ? "animate-spin" : ""} /> {t("지금 백업")}
              </button>
            </div>
          )}
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
  const message = t("{name}, 우리 가족 공간에 초대해요. 폰에서 열고 승인만 누르면 돼요: {url}", { name, url });
  return (
    <div data-testid="family-invite-card" className="mt-4 rounded-lg border border-neutral-200 p-4 text-center dark:border-neutral-700">
      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("{name}께 보낼 초대", { name })}</p>
      <p className="mb-3 text-[11px] text-neutral-500">{t("폰 카메라로 QR을 찍거나, 링크를 카톡·문자로 보내세요.")}</p>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img data-testid="family-invite-qr" src={qr} alt="" className="mx-auto h-44 w-44 rounded" />
      ) : (
        <div className="mx-auto h-44 w-44 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      )}
      <p data-testid="family-invite-url" className="mt-3 break-all rounded bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {url}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(message);
            setCopied(true);
          }}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <Copy size={12} /> {copied ? t("복사했어요") : t("메시지 복사")}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={() => void navigator.share({ text: message }).catch(() => {})}
            className="flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Send size={12} /> {t("보내기")}
          </button>
        )}
        <button onClick={onDone} className="rounded-md px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          {t("닫기")}
        </button>
      </div>
    </div>
  );
}
