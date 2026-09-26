"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UserAvatar } from "@/components/user-avatar";
import type { ActiveWorkspace } from "@/components/sidebar/workspace-switcher";
import { useMe } from "@/stores/me";
import { useT } from "@/i18n/provider";
import { AccountPanel } from "./account-panel";
import { PreferencesPanel } from "./preferences-panel";
import { WorkspaceGeneralPanel, type WorkspacePatch } from "./workspace-general-panel";
import { FamilyNamesPanel } from "./family-names-panel";

export type SettingsTab = "account" | "preferences" | "general" | "family";

function NavTab({
  id,
  active,
  icon,
  label,
  onSelect,
}: {
  id: SettingsTab;
  active: boolean;
  icon: ReactNode;
  label: string;
  onSelect: (id: SettingsTab) => void;
}) {
  return (
    <button
      role="tab"
      id={`settings-tab-${id}`}
      data-testid={`settings-tab-${id}`}
      aria-selected={active}
      onClick={() => onSelect(id)}
      className={`flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-medium leading-5 max-md:h-9 max-md:w-auto max-md:shrink-0 max-md:whitespace-nowrap max-md:px-2.5 text-neutral-900 transition-colors hover:bg-neutral-200/60 dark:text-neutral-100 dark:hover:bg-neutral-700 ${
        active ? "bg-neutral-200/60 dark:bg-neutral-700" : ""
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-600 dark:text-neutral-300">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Notion's Preferences tab glyph (sliders), from docs/settings_my_settings.html. */
function SlidersIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
      <path d="M3 7.375h6.829a2.501 2.501 0 0 0 4.842 0H17a.625.625 0 1 0 0-1.25h-2.329a2.501 2.501 0 0 0-4.842 0H3a.625.625 0 1 0 0 1.25M12.25 5.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5" />
      <path fillRule="evenodd" clipRule="evenodd" d="M7.75 15.75a2.5 2.5 0 0 0 2.421-1.875H17a.625.625 0 0 0 0-1.25h-6.829a2.5 2.5 0 0 0-4.842 0H3a.625.625 0 1 0 0 1.25h2.329A2.5 2.5 0 0 0 7.75 15.75m0-1.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.8v1.9M10 15.3v1.9M2.8 10h1.9M15.3 10h1.9M4.9 4.9l1.35 1.35M13.75 13.75l1.35 1.35M4.9 15.1l1.35-1.35M13.75 6.25l1.35-1.35" strokeLinecap="round" />
    </svg>
  );
}

/** Family names: a small family tree (three linked nodes). */
function FamilyTreeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x="7.5" y="3" width="5" height="4" rx="1" />
      <rect x="2.5" y="13" width="5" height="4" rx="1" />
      <rect x="12.5" y="13" width="5" height="4" rx="1" />
      <path d="M10 7v3M5 13v-3h10v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Settings & members — the settings dialog, opened from the workspace switcher like
 *  the original. Measured on docs/settings_my_settings.html: 90vw (max 1512)
 *  × calc(100% - 100px), r12; a 240px nav with 12/16 500 section labels and
 *  28px tabs (r6, 6px padding, 14/20 500); the panel scrolls, padding
 *  clamp(18px,5vw,60px) × 36px, content max 800px, 36px between blocks. */
export function SettingsModal({
  initialTab = "preferences",
  workspace,
  displayName,
  onClose,
  onWorkspaceSaved,
}: {
  initialTab?: SettingsTab;
  workspace: ActiveWorkspace;
  displayName: string;
  onClose: () => void;
  onWorkspaceSaved: (patch: WorkspacePatch) => void;
}) {
  const t = useT();
  const me = useMe();
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = { displayName: me?.displayName ?? displayName, avatarUrl: me?.avatarUrl };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 max-md:items-stretch" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Settings")}
        data-testid="settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[calc(100%-100px)] w-[90vw] max-w-[1512px] overflow-hidden rounded-xl bg-white shadow-2xl max-md:h-full max-md:w-full max-md:flex-col max-md:rounded-none dark:bg-neutral-800"
      >
        <nav className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto bg-neutral-50 px-2 py-2 max-md:w-full max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:pr-12 max-md:[mask-image:linear-gradient(to_left,transparent_44px,black_76px)] dark:bg-neutral-900" role="tablist" aria-orientation="vertical">
          <div className="flex flex-col gap-0.5 max-md:flex-row max-md:gap-1">
            <div className="px-2 py-1.5 text-xs font-medium leading-4 text-neutral-500 max-md:hidden">{t("Account")}</div>
            <NavTab id="account" active={tab === "account"} onSelect={setTab} icon={<UserAvatar user={shown} size={20} />} label={shown.displayName} />
            <NavTab id="preferences" active={tab === "preferences"} onSelect={setTab} icon={<SlidersIcon />} label={t("Preferences")} />
          </div>
          <div className="flex flex-col gap-0.5 max-md:flex-row max-md:gap-1">
            <div className="px-2 py-1.5 text-xs font-medium leading-4 text-neutral-500 max-md:hidden">{t("Workspace")}</div>
            <NavTab id="general" active={tab === "general"} onSelect={setTab} icon={<GearIcon />} label={t("General")} />
            <NavTab id="family" active={tab === "family"} onSelect={setTab} icon={<FamilyTreeIcon />} label={t("Family names")} />
          </div>
        </nav>
        <div role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="relative flex-1 overflow-y-auto bg-white max-md:border-t max-md:border-neutral-200 dark:bg-neutral-800 max-md:dark:border-neutral-700">
          <div className="flex justify-center px-[clamp(18px,5vw,60px)] py-9 max-md:py-6">
            <div className="flex w-full max-w-[800px] flex-col gap-9">
              {tab === "account" && <AccountPanel initialName={displayName} />}
              {tab === "preferences" && <PreferencesPanel />}
              {tab === "general" && <WorkspaceGeneralPanel workspace={workspace} onSaved={onWorkspaceSaved} />}
              {tab === "family" && <FamilyNamesPanel workspaceId={workspace.id} />}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t("Close")}
          data-testid="settings-close"
          className="absolute right-3 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full max-md:right-1.5 max-md:top-1.5 max-md:h-9 max-md:w-9 text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          <svg aria-hidden viewBox="0 0 16 16" width={14} height={14} fill="currentColor">
            <path d="M12.73 4.33a.75.75 0 1 0-1.06-1.06L8 6.94 4.33 3.27a.75.75 0 0 0-1.06 1.06L6.94 8l-3.67 3.67a.75.75 0 1 0 1.06 1.06L8 9.06l3.67 3.67a.75.75 0 0 0 1.06-1.06L9.06 8z" />
          </svg>
        </button>
      </div>
    </div>,
    document.body
  );
}
