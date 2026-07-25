"use client";

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import type { ActiveWorkspace } from "./workspace-switcher";

interface SavedPatch {
  name: string;
  iconText: string;
  description: string | null;
}

/** Edit the active workspace's name / icon (emoji) / description. */
export function WorkspaceSettingsModal({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: ActiveWorkspace;
  onClose: () => void;
  onSaved: (patch: SavedPatch) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [iconText, setIconText] = useState(workspace.iconText);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);


  async function exportWorkspace() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/workspace/export");
      if (!res.ok) {
        setError("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "workspace-export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed, iconText, description }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      const w = d.workspace;
      onSaved({
        name: w?.name ?? trimmed,
        iconText: w?.iconText ?? iconText,
        description: w?.description ?? (description || null),
      });
      onClose();
      return;
    }
    const d = await res.json().catch(() => ({}));
    setError(d.error ?? "Could not save workspace");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        data-testid="workspace-settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            Workspace settings
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-end gap-2">
            <label className="block w-16 shrink-0">
              <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Icon
              </span>
              <input
                value={iconText}
                onChange={(e) => setIconText(e.target.value)}
                maxLength={2}
                className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-center text-lg outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
                aria-label="Workspace icon"
              />
            </label>
            <label className="block min-w-0 flex-1">
              <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Name
              </span>
              <input
                data-testid="workspace-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                }}
                className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Description
            </span>
            <textarea
              data-testid="workspace-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What is this workspace for?"
              className="w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
            />
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <button
            data-testid="workspace-export"
            onClick={() => void exportWorkspace()}
            disabled={exporting}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <Download size={14} />
            {exporting ? "Exporting\u2026" : "Export"}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            data-testid="workspace-settings-save"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
