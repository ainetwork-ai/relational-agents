"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/user-avatar";
import { useMe, useMeStore } from "@/stores/me";
import { useT } from "@/i18n/provider";
import { SettingsHeader, SettingsRow, SettingsSection } from "./settings-layout";

/** 설정 › 내 계정: photo + display name. Photo goes through POST /api/upload,
 *  then PATCH /api/auth/me; the shared me-store keeps every avatar in sync.
 *  (Was the sidebar-footer profile chip — moved here, docs/i18n-plan.md §5 Q2.) */
export function AccountPanel({ initialName }: { initialName: string }) {
  const t = useT();
  const router = useRouter();
  const me = useMe();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = { displayName: me?.displayName ?? initialName, avatarUrl: me?.avatarUrl };
  const name = draft ?? shown.displayName;
  const dirty = draft !== null && draft.trim() !== shown.displayName;

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
        setError(data.error || t("저장하지 못했습니다"));
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
        setError(data.error || t("업로드하지 못했습니다"));
        return;
      }
      await patch({ avatarUrl: data.url });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsHeader title={t("내 계정")} />
      <SettingsSection title={t("내 프로필")}>
        <div className="flex items-center gap-5">
          <UserAvatar user={shown} size={60} />
          <div className="flex flex-col gap-1.5">
            <button
              data-testid="avatar-upload-button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="h-7 rounded-md border border-[rgba(28,19,1,0.11)] px-2 text-sm text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {busy ? t("처리 중…") : t("사진 변경")}
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
        </div>
        <SettingsRow label={t("선호하는 이름")}>
          <div className="flex items-center gap-1.5">
            <input
              data-testid="profile-name-input"
              value={name}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void patch({ displayName: name });
              }}
              className="h-7 w-56 rounded-md border border-[rgba(28,19,1,0.11)] bg-transparent px-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-600 dark:text-neutral-100"
            />
            {dirty && (
              <button
                data-testid="profile-name-save"
                onClick={() => void patch({ displayName: name })}
                disabled={busy || !name.trim()}
                className="h-7 rounded-md bg-blue-500 px-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {t("저장")}
              </button>
            )}
          </div>
        </SettingsRow>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </SettingsSection>
    </>
  );
}
