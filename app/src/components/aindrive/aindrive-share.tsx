"use client";

import { useEffect, useState } from "react";
import { AinuiButton, AinuiForm, AinuiText } from "@/components/ainui/surface";
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
 * "Which folder do you want to share with your team?" — the step after signing in with aindrive.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/aindrive/share")
      .then((r) => (r.ok ? r.json() : { connected: false, drives: [], teamspaces: [] }))
      .then((d: ShareInfo) => {
        if (!alive) return;
        if (!d.connected || !d.drives.length || !d.teamspaces.length || d.drives.every((x) => x.sharedIn.length)) {
          onDone({ workspaceId: null });
          return;
        }
        setInfo(d);
      })
      .catch(() => alive && onDone({ workspaceId: null }));
    return () => {
      alive = false;
    };
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info) return <p className="py-16 text-center text-sm text-neutral-400">{t("Checking your aindrive folders…")}</p>;

  async function share(values: Record<string, unknown>) {
    if (!info || busy) return;
    const target = info.teamspaces.find((x) => x.id === (values.teamspace as string[])?.[0]);
    if (!target) throw new Error("Select a teamspace");
    const picked = Array.isArray(values.drives) ? values.drives : [];
    const adding = info.drives.filter((d) => picked.includes(d.id) && !d.sharedIn.some((s) => s.teamspaceId === target.id)).map((d) => d.id);
    if (!adding.length) throw new Error("Select folders that are not already shared in this teamspace");
    setBusy(true);
    setError(null);
    const r = await fetch("/api/aindrive/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamspaceId: target.id, driveIds: adding }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { failed?: { driveId: string; error: string }[]; error?: string } | undefined;
    setBusy(false);
    if (!r?.ok) return setError(d?.error ?? d?.failed?.[0]?.error ?? t("Could not share. Please try again."));
    if (d?.failed?.length) {
      const names = d.failed.map((f) => info?.drives.find((x) => x.id === f.driveId)?.name ?? f.driveId).join(", ");
      window.alert(t("Some folders could not be shared: {names}", { names }));
    }
    window.dispatchEvent(new Event("aindrive:teamspace-changed"));
    onDone({ workspaceId: target.workspaceId });
  }

  return <div data-testid="aindrive-share" className="mx-auto w-full max-w-lg space-y-3">
    <AindriveAccountBadge />
    <AinuiText text={t("Which aindrive folders should your team see?")} />
    <AinuiText text={t("Everyone in the teamspace can open the folders you pick. The files stay in aindrive and are read through your account.")} />
    <AinuiForm testId="aindrive-share-form" disabled={busy} fields={[
      { key: "drives", label: t("Drive"), multiple: true, value: info.drives.filter((d) => d.online && !d.sharedIn.length).map((d) => d.id), options: info.drives.map((d) => ({ value: d.id, label: `${d.name}${d.root ? ` / ${d.root}` : ""} · ${d.online ? t("Connected") : t("Offline")}${d.sharedIn.length ? ` · ${t("Shared in: {where}", { where: d.sharedIn.map((s) => s.teamspaceName).join(", ") })}` : ""}` })) },
      { key: "teamspace", label: t("Teamspace to share with"), value: [info.teamspaces[0].id], options: info.teamspaces.map((s) => ({ value: s.id, label: `${s.workspaceName} · ${s.name} (${t("{n} people", { n: s.members })})` })) },
    ]} submitLabel={t("Share with team")} onSubmit={share} />
    {error && <p role="alert">{error}</p>}
    <AinuiButton testId="aindrive-share-skip" label={t("Later")} onClick={() => onDone({ workspaceId: null })} />
  </div>;
}
