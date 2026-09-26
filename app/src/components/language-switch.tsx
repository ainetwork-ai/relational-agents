"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/provider";
import { LANG_COOKIE, LOCALES, LOCALE_NATIVE, type Locale } from "@/i18n/locales";

/**
 * "English · Korean" (each in its own script) for pages seen before signing in (login, an invite). The
 * choice is a cookie — the same one the settings menu writes — and the server
 * re-renders in it. Signed-in people change it in Settings → Preferences.
 */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pick = (l: Locale) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  };
  return (
    <div data-testid="language-switch" className={`flex items-center justify-center gap-1 text-[11px] text-neutral-400 max-md:text-[13px] ${className}`}>
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && <span>·</span>}
          <button
            type="button"
            data-testid={`language-${l}`}
            onClick={() => pick(l)}
            aria-pressed={locale === l}
            className={`rounded px-1 py-0.5 max-md:px-2.5 max-md:py-2 ${locale === l ? "font-semibold text-neutral-700 dark:text-neutral-200" : "hover:text-neutral-600"}`}
          >
            {l === "en" ? "English" : LOCALE_NATIVE[l]}
          </button>
        </span>
      ))}
    </div>
  );
}
