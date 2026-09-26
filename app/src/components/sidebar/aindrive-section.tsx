"use client";

import { AinuiText } from "@/components/ainui/surface";
import { AinuiNavItem } from "@/components/ainui/navigation";
import { ChevronDown, ChevronRight, HardDrive, Share2 } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
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
  const router = useRouter();
  const [collapsed, toggle] = useSectionCollapse("aindrive");
  if (!info?.connected) return null;
  return <section className="mb-4 min-w-0" data-testid="aindrive-section">
    <div className="flex min-w-0 items-center gap-1 px-1">
      <div className="min-w-0 flex-1"><AinuiNavItem size="small" label="aindrive" icon={collapsed ? ChevronRight : ChevronDown} onClick={toggle} /></div>
      {info.drives.length > 0 && <div className="shrink-0"><AinuiNavItem size="small" icon={Share2} testId="aindrive-section-share" label={t("Share with team")} onClick={() => router.push(`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`)} /></div>}
    </div>
    {info.account?.email && <p className="truncate px-2 pb-1 text-[11px] text-neutral-400" title={info.account.email}>{info.account.email}</p>}
    {!collapsed && (info.drives.length ? [...info.drives].sort((a, b) => Number(b.online !== false) - Number(a.online !== false)).map((d) => <AinuiNavItem key={d.id} icon={HardDrive} testId={`aindrive-section-drive-${d.id}`} label={d.name} active={pathname === `/aindrive/d/${d.id}`} status={d.online === false ? "offline" : "online"} title={`${d.name} · ${d.online === false ? t("Offline") : t("Connected")}`} onClick={() => router.push(`/aindrive/d/${d.id}`)} />) : <AinuiText text={t("No drives")} />)}
  </section>;
}
