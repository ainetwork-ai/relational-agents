"use client";
import { useState } from "react";
import { HardDrive, Share2, Users, ChevronDown } from "lucide-react";
import { AinuiNavItem } from "@/components/ainui/navigation";

export default function NavigationFixture() {
  const [selected, setSelected] = useState("phone");
  const [collapsed, setCollapsed] = useState(false);
  return <div className="p-6">
    <aside data-testid="navigation-fixture" className="w-[232px] bg-neutral-50 p-2 dark:bg-neutral-900">
      <div className="mb-2 flex items-center gap-2 px-1 text-sm">
        <span className="min-w-0 flex-1 truncate">Family workspace</span>
        <AinuiNavItem size="icon" icon={Users} label="Family folders" status="synced" onClick={() => setSelected("family")} testId="nav-badge" />
      </div>
      <div className="pl-8">
        <AinuiNavItem icon={HardDrive} label="Family photos and shared memories from all our devices" status="synced" active={selected === "shared"} onClick={() => setSelected("shared")} testId="nav-shared" />
      </div>
      <div className="mt-4 flex items-center gap-1">
        <div className="min-w-0 flex-1"><AinuiNavItem size="small" icon={ChevronDown} label="aindrive" onClick={() => setCollapsed(!collapsed)} testId="nav-toggle" /></div>
        <div className="shrink-0"><AinuiNavItem size="small" icon={Share2} label="Share with team" onClick={() => setSelected("share")} /></div>
      </div>
      <p className="truncate px-2 text-[11px] text-neutral-400">long-account-name@example.test</p>
      {!collapsed && <>
        <AinuiNavItem icon={HardDrive} label="Phone camera and a very long folder name that must truncate" status="online" active={selected === "phone"} onClick={() => setSelected("phone")} testId="nav-phone" />
        <AinuiNavItem icon={HardDrive} label="Desktop archive" status="offline" active={selected === "desktop"} onClick={() => setSelected("desktop")} testId="nav-desktop" />
      </>}
    </aside>
    <output data-testid="nav-selected">{selected}</output>
  </div>;
}
