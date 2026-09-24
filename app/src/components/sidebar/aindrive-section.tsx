"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardDrive } from "lucide-react";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { useSectionCollapse } from "@/hooks/use-section-collapse";
import { useT } from "@/i18n/provider";

/**
 * The person's aindrive, in the sidebar: every drive of their connected
 * account (signed in with aindrive, or connected later), online first. A
 * drive opens whole at /aindrive/d/[driveId]. Absent when no account is
 * connected — the connect step lives where it is needed (sync, attach).
 */
export function AindriveSection() {
  const t = useT();
  const info = useAindriveInfo();
  const pathname = usePathname();
  const [collapsed, toggle] = useSectionCollapse("aindrive");
  if (!info?.connected) return null;
  return (
    <section className="mb-4" data-testid="aindrive-section">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          onClick={toggle}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          aindrive
        </button>
        <span className="truncate pl-2 text-[11px] text-neutral-400">{info.account?.email ?? ""}</span>
      </div>
      {!collapsed &&
        (info.drives.length === 0 ? (
          <p className="px-2 py-1 text-xs text-neutral-400">{t("드라이브가 없습니다")}</p>
        ) : (
          info.drives.map((d) => {
            const href = `/aindrive/d/${d.id}`;
            const active = pathname === href;
            const offline = d.online === false;
            return (
              <Link
                key={d.id}
                href={href}
                data-testid={`aindrive-section-drive-${d.id}`}
                data-online={offline ? "false" : "true"}
                title={offline ? t("꺼져 있음") : t("연결됨")}
                className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800 ${
                  active
                    ? "bg-neutral-200/60 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : offline
                      ? "text-neutral-400"
                      : "text-neutral-600 dark:text-neutral-300"
                }`}
              >
                <HardDrive size={13} className="shrink-0 text-neutral-400" />
                <span className="truncate">{d.name}</span>
                <span
                  className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${offline ? "bg-neutral-300 dark:bg-neutral-600" : "bg-emerald-500"}`}
                />
              </Link>
            );
          })
        ))}
    </section>
  );
}
