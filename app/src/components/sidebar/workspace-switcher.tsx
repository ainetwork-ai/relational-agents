"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, Settings, Check, Users, Sun, Moon, Monitor } from "lucide-react";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/components/dark-mode-toggle";
import { usePagesStore } from "@/stores/pages";
import { WorkspaceSettingsModal } from "./workspace-settings-modal";
import { MembersModal } from "@/components/workspace/members-modal";
import { useWorkspaceUiStore } from "@/stores/workspace-ui";

export interface ActiveWorkspace {
  id: string;
  name: string;
  iconText: string;
  description: string | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  iconText: string;
  description: string | null;
  role?: string;
}

/** Header workspace switcher: current workspace, dropdown to switch/create,
 * and a gear that opens workspace settings. */
export function WorkspaceSwitcher({ workspace }: { workspace: ActiveWorkspace }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setMembersOpen = useWorkspaceUiStore((s) => s.setMembersOpen);
  const themeMode = useThemeMode();
 // header reflects live edits/switches without waiting on the server refresh
  const [display, setDisplay] = useState<ActiveWorkspace>(workspace);
  const [syncedWorkspace, setSyncedWorkspace] = useState(workspace);
  const ref = useRef<HTMLDivElement>(null);

 // Re-sync from the server prop whenever it changes (router.refresh after a
 // switch/rename) — render-time adjustment, not an effect.
  if (syncedWorkspace !== workspace) {
    setSyncedWorkspace(workspace);
    setDisplay(workspace);
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const res = await fetch("/api/workspaces");
      if (!res.ok || !alive) return;
      const d = await res.json();
      if (alive) setList(d.workspaces ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

 // After switching/creating, reload the (workspace-scoped) page tree and
 // navigate straight to the new workspace's first page (/p/<id>) so the URL
 // is that workspace's own page, not a shared home. Empty workspace → /home.
  async function refreshWorkspace() {
    await usePagesStore.getState().load();
    const roots = usePagesStore.getState().roots;
    router.push(roots.length ? `/p/${roots[0].id}` : "/home");
    router.refresh();
  }

  async function switchTo(id: string) {
    if (id === display.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    setBusy(false);
    if (!res.ok) return;
    const picked = list.find((w) => w.id === id);
    if (picked) {
      setDisplay({
        id: picked.id,
        name: picked.name,
        iconText: picked.iconText,
        description: picked.description,
      });
    }
    setOpen(false);
    await refreshWorkspace();
  }

  async function createWorkspace() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) return;
    const d = await res.json();
    setNewName("");
    setCreating(false);
    setOpen(false);
    if (d.workspace) {
      setDisplay({
        id: d.workspace.id,
        name: d.workspace.name,
        iconText: d.workspace.iconText,
        description: d.workspace.description ?? null,
      });
    }
    await refreshWorkspace();
  }

  return (
    <div ref={ref} className="relative flex min-w-0 flex-1 items-center gap-0.5">
      <button
        data-testid="workspace-switcher"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-700"
      >
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-300 text-[10px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
          {(display.iconText || display.name).slice(0, 1).toUpperCase()}
        </div>
        <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {display.name}
        </span>
        <ChevronsUpDown size={13} className="ml-auto shrink-0 text-neutral-400" />
      </button>
      <MembersModal />

      {open && (
        <div className="popover-anim absolute left-0 top-10 z-50 w-60 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          <div className="max-h-64 overflow-y-auto">
            {list.map((w) => (
              <button
                key={w.id}
                data-testid={`workspace-switch-${w.id}`}
                onClick={() => switchTo(w.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-200 text-[10px] font-bold text-neutral-600 dark:bg-neutral-600 dark:text-neutral-200">
                  {(w.iconText || w.name).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === display.id && (
                  <Check size={13} className="shrink-0 text-blue-500" />
                )}
              </button>
            ))}
          </div>

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          {/* Appearance — the footer icon alone was undiscoverable, so the
              theme lives here too, spelled out (R2 follow-up) */}
          <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-neutral-400">Appearance</p>
          {([
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
            ["system", "System", Monitor],
          ] as [ThemeMode, string, typeof Sun][]).map(([value, label, Icon]) => (
            <button
              key={value}
              data-testid={`theme-option-${value}`}
              onClick={() => setThemeMode(value)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
            >
              <Icon size={14} />
              {label}
              {themeMode === value && <Check size={13} className="ml-auto shrink-0 text-blue-500" />}
            </button>
          ))}

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          <button
            data-testid="workspace-settings-button"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <Settings size={14} />
            Settings
          </button>
          <button
            data-testid="members-button"
            onClick={() => {
              setOpen(false);
              setMembersOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <Users size={14} />
            Members
          </button>

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          {creating ? (
            <div className="p-1">
              <input
                autoFocus
                data-testid="workspace-create-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createWorkspace();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Workspace name"
                className="mb-1 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
              />
              <button
                data-testid="workspace-create-submit"
                onClick={() => void createWorkspace()}
                className="w-full rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                disabled={busy}
              >
                Create workspace
              </button>
            </div>
          ) : (
            <button
              data-testid="workspace-create-button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
            >
              <Plus size={14} />
              Create workspace
            </button>
          )}
        </div>
      )}

      {settingsOpen && (
        <WorkspaceSettingsModal
          workspace={display}
          onClose={() => setSettingsOpen(false)}
          onSaved={(patch) => {
            setDisplay((prev) => ({ ...prev, ...patch }));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
