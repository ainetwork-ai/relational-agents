"use client";

import { useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useDismiss } from "@/hooks/use-dismiss";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, Settings, Check, Users, LogOut } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { recordWorkspaceVisit } from "@/lib/recent-workspaces";
import { SettingsModal } from "@/components/settings/settings-modal";
import { useT } from "@/i18n/provider";
import { MembersModal } from "@/components/workspace/members-modal";
import { useWorkspaceUiStore } from "@/stores/workspace-ui";
import { initial } from "@/lib/glyph";

export interface ActiveWorkspace {
  id: string;
  name: string;
  iconText: string;
  iconUrl?: string | null;
  description: string | null;
}

const ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700";

interface WorkspaceRow {
  id: string;
  name: string;
  iconText: string;
  iconUrl?: string | null;
  description: string | null;
  role?: string;
}

/** Header workspace switcher: current workspace, dropdown to switch/create,
 * and — like the original's — the way into Settings, Invite members and Log out. */
export function WorkspaceSwitcher({ workspace, displayName }: { workspace: ActiveWorkspace; displayName: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setMembersOpen = useWorkspaceUiStore((s) => s.setMembersOpen);
 // header reflects live edits/switches without waiting on the server refresh
  const [display, setDisplay] = useState<ActiveWorkspace>(workspace);
  const [syncedWorkspace, setSyncedWorkspace] = useState(workspace);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
 // portalled and placed: the sidebar shell clips, and this 316px list lost
 // 28px off the bottom of a 340px-tall window
  useAnchored(open, btnRef, popRef, { align: "start" });

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

  useDismiss(open, () => {
    setOpen(false);
        setCreating(false);
  }, ref, popRef);

  /**
   * Leave for the new workspace immediately.
   *
   * This used to load the page tree first so it could open that workspace's
   * first page — which meant the URL only changed after a round trip, and on a
   * slow connection the click looked like it had done nothing. The address bar
   * moves first now; the tree arrives behind it.
   */
  function goToWorkspace() {
    router.push("/home");
    router.refresh();
    void usePagesStore.getState().load();
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
    recordWorkspaceVisit(id);
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
    goToWorkspace();
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
 // A new workspace owns nothing yet, so its own home is the only honest
 // destination — and it is the fast one.
    goToWorkspace();
  }

  return (
    <div ref={ref} className="relative flex min-w-0 flex-1 items-center gap-0.5">
      <button
        ref={btnRef}
        data-testid="workspace-switcher"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-700"
      >
        {display.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={display.iconUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-300 text-[10px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
            {initial(display.iconText || display.name)}
          </div>
        )}
        <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {display.name}
        </span>
        <ChevronsUpDown size={13} className="ml-auto shrink-0 text-neutral-400" />
      </button>
      <MembersModal />

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 w-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          >
          {/* the original's order: Settings · Invite members / workspace list /
              Add a workspace / Log out */}
          <button
            data-testid="workspace-settings-button"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
            className={ITEM}
          >
            <Settings size={14} />
            {t("Settings")}
          </button>
          <button
            data-testid="members-button"
            onClick={() => {
              setOpen(false);
              setMembersOpen(true);
            }}
            className={ITEM}
          >
            <Users size={14} />
            {t("Invite members")}
          </button>

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          <div className="max-h-64 overflow-y-auto">
            {list.map((w) => (
              <button
                key={w.id}
                data-testid={`workspace-switch-${w.id}`}
                onClick={() => switchTo(w.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                {w.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.iconUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-200 text-[10px] font-bold text-neutral-600 dark:bg-neutral-600 dark:text-neutral-200">
                    {initial(w.iconText || w.name)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === display.id && (
                  <Check size={13} className="shrink-0 text-blue-500" />
                )}
              </button>
            ))}
          </div>

          {creating ? (
            <div className="p-1">
              <input
                autoFocus
                data-testid="workspace-create-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (!isImeComposing(e) && e.key === "Enter") void createWorkspace();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder={t("Workspace name")}
                className="mb-1 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
              />
              <button
                data-testid="workspace-create-submit"
                onClick={() => void createWorkspace()}
                className="w-full rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                disabled={busy}
              >
                {t("Create workspace")}
              </button>
            </div>
          ) : (
            <button
              data-testid="workspace-create-button"
              onClick={() => setCreating(true)}
              className={ITEM}
            >
              <Plus size={14} />
              {t("Add workspace")}
            </button>
          )}

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          <button
            data-testid="logout-button"
            onClick={async () => {
              setOpen(false);
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
            className={ITEM}
          >
            <LogOut size={14} />
            {t("Log out")}
          </button>
          </div>,
          document.body
        )}

      {settingsOpen && (
        <SettingsModal
          workspace={display}
          displayName={displayName}
          onClose={() => setSettingsOpen(false)}
          onWorkspaceSaved={(patch) => {
            setDisplay((prev) => ({ ...prev, ...patch }));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
