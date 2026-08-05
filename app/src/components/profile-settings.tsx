"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/user-avatar";
import { useMe, useMeStore } from "@/stores/me";

/** Sidebar-footer profile chip: avatar + name, click → edit both in place.
 * Photo goes through POST /api/upload, then PATCH /api/auth/me. Reads the
 * shared me-store so the face pile on a page shows the same photo. */
export function ProfileSettings({ initialName }: { initialName: string }) {
  const router = useRouter();
  const me = useMe();
  const [open, setOpen] = useState(false);
 // null while untouched, so the input tracks the store until you start typing
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = { displayName: me?.displayName ?? initialName, avatarUrl: me?.avatarUrl };
  const name = draft ?? shown.displayName;

  async function patch(body: { displayName?: string; avatarUrl?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Update failed");
        return;
      }
      useMeStore.getState().setMe(data.user);
      setDraft(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      await patch({ avatarUrl: data.url });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <button
        data-testid="profile-chip"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 items-center gap-1.5 rounded-md text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
        title="Profile settings"
      >
        <UserAvatar user={shown} size={20} />
        <span className="truncate">{shown.displayName}</span>
      </button>

      {open && (
        <div className="popover-anim absolute bottom-8 left-0 z-50 w-56 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-[#232323]">
          <div className="mb-2 flex items-center gap-2.5">
            <UserAvatar user={shown} size={40} />
            <button
              data-testid="avatar-upload-button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {busy ? "Working…" : "Change photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              data-testid="profile-name-input"
              value={name}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void patch({ displayName: name });
              }}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              data-testid="profile-name-save"
              onClick={() => void patch({ displayName: name })}
              disabled={busy || !name.trim()}
              className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Save
            </button>
          </div>
          {error && <div className="mt-1.5 text-xs text-red-500">{error}</div>}
        </div>
      )}
    </div>
  );
}
