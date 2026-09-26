"use client";

import { useEffect, useState } from "react";
import { AinuiDriveBrowser } from "@/components/ainui/drive-browser";
import { AinuiButton, AinuiForm, AinuiText } from "@/components/ainui/surface";
import { loadAindriveInfo, type AindriveInfo } from "@/lib/aindrive-client";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { useT } from "@/i18n/provider";
import { AindriveAccountBadge, AindriveConnect } from "./aindrive-connect";

/** Where the picker reads from: one of your own drives, or a folder a
 *  teammate shared into a teamspace you are in (read as them). */
interface Source {
  key: string;
  label: string;
  driveId: string;
  root: string;
  /** teamspace link id, for a shared folder */
  linkId?: string;
  group: "mine" | "shared";
}

interface SharedFolder {
  id: string;
  name: string;
  driveId: string;
  root: string;
  teamspaceName: string;
  sharedBy: string | null;
}

/**
 * "Import from aindrive": pick a file from the aindrive folders offered here.
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
  const [shared, setShared] = useState<SharedFolder[]>([]);
  const [sourceKey, setSourceKey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const sources: Source[] = [
    ...(info?.drives ?? []).map((d) => ({
      key: `d:${d.id}`,
      label: d.name,
      driveId: d.id,
      root: d.root,
      group: "mine" as const,
    })),
    ...shared.map((f) => ({
      key: `l:${f.id}`,
      label: `${f.name}${f.sharedBy ? ` · ${f.sharedBy}` : ""}`,
      driveId: f.driveId,
      root: f.root,
      linkId: f.id,
      group: "shared" as const,
    })),
  ];
  const source = sources.find((x) => x.key === sourceKey);

  const open = (s: Source | undefined) => {
    if (!s) return;
    setSourceKey(s.key);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([
      loadAindriveInfo(),
      fetch("/api/aindrive/shared")
        .then((r) => (r.ok ? r.json() : { folders: [] }))
        .then((d: { folders: SharedFolder[] }) => d.folders)
        .catch(() => [] as SharedFolder[]),
    ]).then(([i, folders]) => {
      if (!alive) return;
      setInfo(i);
      setShared(folders);
      const first = i.drives.find((d) => d.online !== false) ?? i.drives[0];
      if (first) {
        setSourceKey(`d:${first.id}`);
      } else if (folders[0]) {
        setSourceKey(`l:${folders[0].id}`);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        aria-label={t("From aindrive")}
        data-testid="aindrive-picker"
        className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl dark:bg-neutral-900"
      >
        <div className="p-4">
          <AinuiText text={t("From aindrive")} />
          <AinuiButton label={t("Close")} onClick={onClose} />
          {sources.length > 1 && <AinuiForm fields={[{ key: "source", label: t("Drive"), value: [sourceKey], options: sources.map((s) => ({ value: s.key, label: `${s.group === "mine" ? t("My aindrive") : t("Shared in teamspaces")} · ${s.label}` })) }]} submitLabel={t("Open")} onSubmit={(v) => open(sources.find((s) => s.key === (v.source as string[])?.[0]))} />}
        </div>
        {info?.connected && (
          <div className="px-4 pt-2">
            <AindriveAccountBadge />
          </div>
        )}
        <p className="px-4 pt-1 text-[11px] text-neutral-400">
          {t("Inserted as a link, not a copy — the preview follows the file on the drive.")}
        </p>

        {info && info.configured && !info.connected && !shared.length ? (
          <div className="p-4">
            <AindriveConnect
              onConnected={() =>
                void loadAindriveInfo(true).then((i) => {
                  setInfo(i);
                  const first = i.drives.find((d) => d.online !== false) ?? i.drives[0];
                  if (first) open({ key: `d:${first.id}`, label: first.name, driveId: first.id, root: first.root, group: "mine" });
                })
              }
            />
          </div>
        ) : info && !info.configured ? (
          <p className="p-4 text-sm text-neutral-500">{t("aindrive is not configured on this server.")}</p>
        ) : info && sources.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">{t("No aindrive folders to pick from.")}</p>
        ) : (
          <div className="min-h-48 overflow-auto p-3" data-testid="aindrive-picker-list">
            {source && <AinuiDriveBrowser source={source.linkId ? `/api/aindrive/links/${source.linkId}` : `/api/aindrive/drives/${source.driveId}`} onPick={({ driveId, path }) => {
              if (!info?.base) return setError(t("Unknown aindrive address"));
              onPick({ url: aindriveFileUrl(info.base, { driveId, path }), name: path.split("/").pop() || path });
            }} />}
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
