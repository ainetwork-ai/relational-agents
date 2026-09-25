"use client";

import { useEffect, useState } from "react";
import { Check, HardDrive, Users } from "lucide-react";
import { useT } from "@/i18n/provider";
import { AindriveAccountBadge } from "./aindrive-connect";

interface ShareDrive {
  id: string;
  name: string;
  root: string;
  online: boolean;
  sharedIn: { teamspaceId: string; teamspaceName: string }[];
}

interface ShareTeamspace {
  id: string;
  name: string;
  icon: string | null;
  workspaceId: string;
  workspaceName: string;
  members: number;
}

interface ShareInfo {
  connected: boolean;
  drives: ShareDrive[];
  teamspaces: ShareTeamspace[];
}

/**
 * "어떤 폴더를 팀과 공유할까요?" — the step after signing in with aindrive.
 *
 * The person's own drives, as aindrive lists them for their account, and the
 * teamspaces they are in. The ones they tick are linked into the teamspace
 * they pick: everyone there can open them from then on, read through the
 * sharer's own account. Drives not shared anywhere yet, and switched on, start
 * ticked; nothing to share (no drives, or every one already shared) skips the
 * step without showing it.
 */
export function AindriveShare({ onDone }: { onDone: (to: { workspaceId: string | null }) => void }) {
  const t = useT();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [teamspaceId, setTeamspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/aindrive/share")
      .then((r) => (r.ok ? r.json() : { connected: false, drives: [], teamspaces: [] }))
      .then((d: ShareInfo) => {
        if (!alive) return;
        const fresh = d.drives.filter((x) => x.online && !x.sharedIn.length);
        if (!d.connected || !d.drives.length || !d.teamspaces.length || d.drives.every((x) => x.sharedIn.length)) {
          onDone({ workspaceId: null });
          return;
        }
        setInfo(d);
        setPicked(new Set(fresh.map((x) => x.id)));
        setTeamspaceId(d.teamspaces[0].id);
      })
      .catch(() => alive && onDone({ workspaceId: null }));
    return () => {
      alive = false;
    };
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info) return <p className="py-16 text-center text-sm text-neutral-400">{t("aindrive 폴더를 확인하는 중…")}</p>;

  const target = info.teamspaces.find((x) => x.id === teamspaceId) ?? info.teamspaces[0];
  // what sharing now adds: ticked, and not already in the chosen teamspace
  const adding = [...picked].filter(
    (id) => !info.drives.find((d) => d.id === id)?.sharedIn.some((s) => s.teamspaceId === target.id)
  );
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function share() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/aindrive/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamspaceId: target.id, driveIds: adding }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { failed?: { driveId: string; error: string }[]; error?: string } | undefined;
    setBusy(false);
    if (!r?.ok) return setError(d?.error ?? d?.failed?.[0]?.error ?? t("공유하지 못했습니다. 다시 시도해 주세요."));
    if (d?.failed?.length) {
      const names = d.failed.map((f) => info?.drives.find((x) => x.id === f.driveId)?.name ?? f.driveId).join(", ");
      window.alert(t("일부 폴더는 공유하지 못했습니다: {names}", { names }));
    }
    window.dispatchEvent(new Event("aindrive:teamspace-changed"));
    onDone({ workspaceId: target.workspaceId });
  }

  return (
    <div data-testid="aindrive-share" className="mx-auto w-full max-w-lg">
      <div className="mb-1">
        <AindriveAccountBadge />
      </div>
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{t("어떤 aindrive 폴더를 팀과 공유할까요?")}</h1>
      <p className="mb-5 text-sm text-neutral-500">
        {t("고른 폴더는 팀스페이스의 모든 멤버가 열어 볼 수 있어요. 파일은 aindrive에 그대로 있고, 내 계정 권한으로 읽힙니다.")}
      </p>

      <ul className="mb-5 divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
        {info.drives.map((d) => {
          const on = picked.has(d.id);
          const already = d.sharedIn.some((s) => s.teamspaceId === target.id);
          return (
            <li key={d.id}>
              <label
                data-testid={`aindrive-share-drive-${d.id}`}
                className={`flex items-center gap-3 px-3 py-2.5 ${already ? "opacity-60" : "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/60"}`}
              >
                <input
                  type="checkbox"
                  checked={already || on}
                  disabled={already}
                  onChange={() => toggle(d.id)}
                  className="h-4 w-4 accent-neutral-900 dark:accent-neutral-100"
                />
                <HardDrive size={15} className="shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                    {d.name}
                    {d.root ? <span className="text-neutral-400"> / {d.root}</span> : null}
                  </span>
                  {d.sharedIn.length > 0 && (
                    <span className="block truncate text-[11px] text-neutral-400">
                      {t("공유 중: {where}", { where: d.sharedIn.map((s) => s.teamspaceName).join(", ") })}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${d.online ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
                  {d.online ? t("연결됨") : t("꺼져 있음")}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <label className="mb-1 block text-xs font-medium text-neutral-500">{t("공유할 팀스페이스")}</label>
      <select
        data-testid="aindrive-share-teamspace"
        value={target.id}
        onChange={(e) => setTeamspaceId(e.target.value)}
        className="mb-1 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        {info.teamspaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.workspaceName} · {s.icon ? `${s.icon} ` : ""}
            {s.name} ({t("{n}명", { n: s.members })})
          </option>
        ))}
      </select>
      <p className="mb-5 flex items-center gap-1 text-[11px] text-neutral-400">
        <Users size={11} /> {t("{n}명이 이 폴더들을 보게 됩니다.", { n: target.members })}
      </p>

      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          data-testid="aindrive-share-submit"
          onClick={() => void share()}
          disabled={busy || adding.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Check size={14} />
          {busy ? t("공유하는 중…") : t("{n}개 폴더 공유하기", { n: adding.length })}
        </button>
        <button
          data-testid="aindrive-share-skip"
          onClick={() => onDone({ workspaceId: null })}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {t("나중에")}
        </button>
      </div>
    </div>
  );
}
