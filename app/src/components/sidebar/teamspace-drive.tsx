"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText, HardDrive, Plus } from "lucide-react";
import { LinkForm, errorOf, type Drive } from "@/components/home/aindrive-panel";
import { useT } from "@/i18n/provider";

/**
 * A teamspace's aindrive link in the sidebar: the row that opens it
 * (/aindrive/[id]) and the 새로 추가 menu that offers to create one. Linking,
 * unlinking and backups live on that page; this only needs to know whether a
 * link exists. Pages announce a change with the `aindrive:teamspace-changed`
 * window event.
 */

const CHANGED = "aindrive:teamspace-changed";

interface TsDrive {
  id: string;
  name: string;
}

function useTeamspaceDrive(teamspaceId: string): TsDrive | null | undefined {
  const [drive, setDrive] = useState<TsDrive | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
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

/** The linked folder's row, under the teamspace's pages. */
export function TeamspaceDriveRow({ teamspaceId }: { teamspaceId: string }) {
  const drive = useTeamspaceDrive(teamspaceId);
  const pathname = usePathname();
  if (!drive) return null;
  const active = pathname === `/aindrive/${drive.id}`;
  return (
    <Link
      data-testid={`teamspace-drive-row-${teamspaceId}`}
      href={`/aindrive/${drive.id}`}
      className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-sm transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800 ${
        active ? "bg-neutral-200/60 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"
      }`}
      style={{ paddingLeft: "36px" }}
    >
      <HardDrive size={14} className="shrink-0 text-neutral-400" />
      <span className="truncate">{drive.name}</span>
    </Link>
  );
}

/** 새로 추가: a page, or — while the teamspace has none — an aindrive folder. */
export function TeamspaceAddRow({ teamspaceId, onAddPage }: { teamspaceId: string; onAddPage: () => void }) {
  const t = useT();
  const router = useRouter();
  const drive = useTeamspaceDrive(teamspaceId);
  const [menu, setMenu] = useState(false);
  const [linking, setLinking] = useState<Drive[] | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  async function openLink() {
    setMenu(false);
    setLinkError(null);
    const res = await fetch("/api/aindrive");
    const d = res.ok ? ((await res.json()) as { configured: boolean; drives: Drive[] }) : null;
    if (!d?.configured) return setLinkError(t("이 서버에는 aindrive가 설정되어 있지 않습니다."));
    setLinking(d.drives);
  }

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
          className="absolute left-8 z-40 mt-1 w-52 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
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
              onClick={() => void openLink()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <HardDrive size={14} className="text-neutral-400" />
              <span>
                aindrive
                <span className="block text-[11px] text-neutral-400">{t("이 팀스페이스를 OKF로 백업")}</span>
              </span>
            </button>
          )}
        </div>
      )}
      {linkError && <p className="px-2 py-1 text-xs text-red-600" style={{ paddingLeft: "36px" }}>{linkError}</p>}
      {linking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLinking(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("aindrive 연결")}
            data-testid="teamspace-aindrive-dialog"
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
          >
            <h2 className="mb-1 text-base font-semibold">{t("aindrive 연결")}</h2>
            <p className="mb-4 text-xs text-neutral-500">
              {t("이 팀스페이스의 페이지와 데이터베이스가 OKF 형식으로 이 폴더에 백업되고, 폴더에 이미 있는 파일도 여기서 볼 수 있습니다.")}
            </p>
            <LinkForm
              drives={linking}
              withName
              onCancel={() => setLinking(null)}
              submit={async (body) => {
                const res = await fetch(`/api/teamspaces/${teamspaceId}/drives`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!res.ok) return errorOf(res, t("연결할 수 없습니다"));
                const { drive: created } = (await res.json()) as { drive: TsDrive };
                setLinking(null);
                window.dispatchEvent(new Event(CHANGED));
                router.push(`/aindrive/${created.id}`);
                return null;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
