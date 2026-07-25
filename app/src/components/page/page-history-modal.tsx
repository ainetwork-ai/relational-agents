"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Snapshot {
  id: string;
  title: string;
  blockCount: number;
  createdAt: string;
}

/** Page history: list of saved versions with one-click restore. The current
 * state is snapshotted server-side before a restore, so restores are undoable. */
export function PageHistoryModal({
  pageId,
  onClose,
}: {
  pageId: string;
  onClose: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/pages/${pageId}/history`);
      if (!res.ok) return setSnapshots([]);
      const data = (await res.json()) as { snapshots: Snapshot[] };
      setSnapshots(data.snapshots);
    })();
  }, [pageId]);

  async function restore(id: string) {
    setBusy(id);
    const res = await fetch(`/api/pages/${pageId}/history/${id}`, { method: "POST" });
    if (res.ok) {
      location.reload(); // re-fetch page + blocks wholesale
      return;
    }
    setBusy(null);
  }

 // portal: the sticky header's backdrop-blur creates a containing block
 // that would trap position:fixed descendants
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        data-testid="page-history-modal"
        className="flex max-h-[70vh] w-[28rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-700">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            Page history
          </h2>
          <button
            data-testid="page-history-close"
            onClick={onClose}
            aria-label="Close history"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {snapshots === null ? (
            <p className="py-6 text-center text-xs text-neutral-400">Loading…</p>
          ) : snapshots.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">
              No versions yet — versions are saved automatically as you edit.
            </p>
          ) : (
            snapshots.map((s) => (
              <div
                key={s.id}
                data-testid={`page-history-item-${s.id}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-800 dark:text-neutral-200">
                    {s.title || "Untitled"}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {new Date(s.createdAt).toLocaleString()} · {s.blockCount} block
                    {s.blockCount === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  data-testid={`page-history-restore-${s.id}`}
                  disabled={busy !== null}
                  onClick={() => void restore(s.id)}
                  className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  {busy === s.id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
