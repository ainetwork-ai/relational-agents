"use client";

import { useState } from "react";
import { useT } from "@/i18n/provider";

/** Password gate for a protected share link — unlocks via an httpOnly cookie. */
export function SharePasswordForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function submit() {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/share/${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      location.reload();
      return;
    }
    setError(true);
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white dark:bg-[#191919]">
      <form
        data-testid="share-pw-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex w-72 flex-col gap-2 text-center"
      >
        <p className="text-3xl">🔒</p>
        <h1 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {t("이 페이지는 비밀번호로 보호되어 있습니다")}
        </h1>
        <input
          autoFocus
          type="password"
          data-testid="share-pw-input"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("비밀번호 입력")}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
        />
        {error && (
          <p data-testid="share-pw-error" className="text-xs text-red-500">
            {t("비밀번호가 틀렸습니다. 다시 시도하세요.")}
          </p>
        )}
        <button
          type="submit"
          data-testid="share-pw-submit"
          disabled={busy}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? t("확인 중…") : t("계속")}
        </button>
      </form>
    </main>
  );
}
