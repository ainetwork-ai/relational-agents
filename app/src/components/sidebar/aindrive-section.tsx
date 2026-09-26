"use client";

import { AinuiButton, AinuiText } from "@/components/ainui/surface";
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
  return <section className="mb-4" data-testid="aindrive-section">
    <AinuiButton label={`aindrive · ${info.account?.email ?? ""}`} onClick={toggle} />
    {info.drives.length > 0 && <AinuiButton testId="aindrive-section-share" label={t("Share with team")} onClick={() => router.push(`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`)} />}
    {!collapsed && (info.drives.length ? info.drives.map((d) => <AinuiButton key={d.id} testId={`aindrive-section-drive-${d.id}`} label={`${pathname === `/aindrive/d/${d.id}` ? "✓ " : ""}${d.name} · ${d.online === false ? t("Offline") : t("Connected")}`} onClick={() => router.push(`/aindrive/d/${d.id}`)} />) : <AinuiText text={t("No drives")} />)}
  </section>;
}
