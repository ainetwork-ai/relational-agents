"use client";

import { useState } from "react";

/** "Duplicate" on a public page: copies it into the visitor's own workspace. */
export function ShareDuplicateButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    const res = await fetch(`/api/share/${token}/duplicate`, { method: "POST" });
    if (res.status === 401) {
      location.href = "/login";
      return;
    }
    if (res.ok) {
      const { pageId } = (await res.json()) as { pageId: string };
      location.href = `/p/${pageId}`;
      return;
    }
    setBusy(false);
  }

  return (
    <button
      data-testid="share-duplicate"
      disabled={busy}
      onClick={() => void duplicate()}
      className="fixed right-4 top-3 z-40 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
    >
      {busy ? "Duplicating…" : "⧉ Duplicate"}
    </button>
  );
}
