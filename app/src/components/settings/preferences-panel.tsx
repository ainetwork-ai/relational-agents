"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/components/dark-mode-toggle";
import { useMeStore } from "@/stores/me";
import { useLocale, useT } from "@/i18n/provider";
import { LOCALES, LOCALE_NATIVE, type Locale } from "@/i18n/locales";
import { SettingsHeader, SettingsRow, SettingsSection } from "./settings-layout";
import { SettingsSelect } from "./settings-select";

/** 설정 › 기본 설정: 테마 and 언어 및 시간 › 언어. The original's other rows
 *  (숫자 형식, 주 시작 요일, 시간대…) are deferred — docs/i18n-plan.md §5 Q3. */
export function PreferencesPanel() {
  const t = useT();
  const router = useRouter();
  const locale = useLocale();
  const theme = useThemeMode();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeLanguage(next: Locale) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("저장하지 못했습니다"));
        return;
      }
      if (data.user) useMeStore.getState().setMe(data.user);
      // the server re-renders the whole tree in the new language (LocaleProvider)
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "system", label: t("시스템 설정 사용") },
    { value: "light", label: t("라이트") },
    { value: "dark", label: t("다크") },
  ];

  return (
    <>
      <SettingsHeader title={t("기본 설정")} subtitle={t("모양새와 작동 방식을 선택하세요")} />
      <SettingsSection title={t("테마")}>
        <SettingsRow label={t("테마")} description={t("이 기기에서 사용할 테마를 선택하세요.")}>
          <SettingsSelect testid="theme-select" value={theme} options={themeOptions} onChange={setThemeMode} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("언어 및 시간")}>
        <SettingsRow label={t("언어")} description={t("사용할 언어를 선택합니다.")}>
          <div className={saving ? "pointer-events-none opacity-60" : undefined}>
            <SettingsSelect
              testid="language-select"
              value={locale}
              options={LOCALES.map((l) => ({ value: l, label: LOCALE_NATIVE[l], sub: t(LOCALE_NATIVE[l]) }))}
              onChange={(v) => void changeLanguage(v)}
            />
          </div>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
