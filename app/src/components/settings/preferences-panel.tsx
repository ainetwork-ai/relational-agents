"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/components/dark-mode-toggle";
import { useMeStore } from "@/stores/me";
import { useLocale, useT } from "@/i18n/provider";
import { LOCALES, LOCALE_NATIVE, type Locale } from "@/i18n/locales";
import { SettingsHeader, SettingsRow, SettingsSection } from "./settings-layout";
import { SettingsSelect } from "./settings-select";

/** Settings › Preferences: Theme and Language & time › Language. The original's other rows
 *  (number format, start of week, time zone…) are deferred — docs/i18n-plan.md §5 Q3. */
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
        setError(data.error || t("Couldn't save"));
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
    { value: "system", label: t("Use system setting") },
    { value: "light", label: t("Light") },
    { value: "dark", label: t("Dark") },
  ];

  return (
    <>
      <SettingsHeader title={t("Preferences")} subtitle={t("Choose how you want it to look and behave")} />
      <SettingsSection title={t("Theme")}>
        <SettingsRow label={t("Theme")} description={t("Choose a theme for this device.")}>
          <SettingsSelect testid="theme-select" value={theme} options={themeOptions} onChange={setThemeMode} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("Language & time")}>
        <SettingsRow label={t("Language")} description={t("Choose the language you want to use.")}>
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
