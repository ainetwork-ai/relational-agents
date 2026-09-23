"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initial } from "@/lib/glyph";

interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Sidebar-footer profile chip: avatar + name, click → edit both in place.
 * Photo goes through POST /api/upload, then PATCH /api/auth/me. */
export function ProfileSettings({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setMe(d.user);
          setName(d.user.displayName);
        }
      })
      .catch(() => {});
  }, []);

 // Close and throw away an unsaved edit — reopening should never show a name
 // the server does not have. Focus returns to the chip so the keyboard path
 // does not dump the caret at the top of the document.
  const close = useCallback(
    (refocus = false) => {
      setOpen(false);
      setError(null);
      setSaved(false);
      setName(me?.displayName ?? initialName);
      if (refocus) chipRef.current?.focus();
    },
    [me, initialName]
  );

 // A popover with no way out but the button that opened it is a trap: click
 // anywhere else, or press Escape, and it goes away.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

 // Opening puts the caret in the name field — the one thing this popover is
 // for — with the current name selected so typing replaces it.
  useEffect(() => {
    if (open) nameRef.current?.select();
  }, [open]);

  async function patch(body: { displayName?: string; avatarUrl?: string }) {
    setBusy(true);
    setError(null);
    setSaved(false);
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
      setMe(data.user);
      setName(data.user.displayName);
      setSaved(true);
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

  const avatar = me?.avatarUrl ? (
 // eslint-disable-next-line @next/next/no-img-element
    <img src={me.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
  ) : (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-300 text-[10px] font-medium text-neutral-700 dark:bg-neutral-600 dark:text-neutral-200">
      {initial(me?.displayName ?? initialName)}
    </span>
  );

  const currentName = me?.displayName ?? initialName;
  const dirty = name.trim() !== currentName && name.trim().length > 0;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        ref={chipRef}
        data-testid="profile-chip"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        title="Profile settings"
      >
        {avatar}
        <span className="truncate">{currentName}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Profile settings"
          data-testid="profile-popover"
          className="popover-anim absolute bottom-8 left-0 z-50 w-60 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-[#232323]"
        >
          <div className="mb-3 flex items-center gap-2.5">
            {me?.avatarUrl ? (
 // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                {initial(currentName)}
              </span>
            )}
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <button
                data-testid="avatar-upload-button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {busy ? "Working…" : me?.avatarUrl ? "Change photo" : "Add photo"}
              </button>
              {me?.avatarUrl && (
                <button
                  data-testid="avatar-remove-button"
                  onClick={() => void patch({ avatarUrl: "" })}
                  disabled={busy}
                  className="px-2 text-[11px] text-neutral-400 transition-colors hover:text-red-500 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
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

          <label
            htmlFor="profile-name"
            className="mb-1 block text-[11px] font-medium text-neutral-400 dark:text-neutral-500"
          >
            Name
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="profile-name"
              ref={nameRef}
              data-testid="profile-name-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && dirty && !busy) void patch({ displayName: name });
              }}
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <button
              data-testid="profile-name-save"
              onClick={() => void patch({ displayName: name })}
              disabled={busy || !dirty}
              className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Save
            </button>
          </div>
          <div className="mt-1.5 min-h-[1rem] text-[11px] leading-4">
            {error ? (
              <span className="text-red-500">{error}</span>
            ) : saved ? (
              <span data-testid="profile-saved" className="text-emerald-600 dark:text-emerald-400">
                Saved
              </span>
            ) : (
              <span className="text-neutral-400 dark:text-neutral-500">
                Your name is shown everywhere, including in relationship records.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
