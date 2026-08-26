"use client";

import type { ReactNode } from "react";

/** Building blocks of a settings panel, sized from the original's 기본 설정
 *  tab (docs/settings_my_settings.html): the column is max 800px with 36px
 *  between blocks; a section heading is 16px/500 over a 1px rule (pb 12,
 *  mb 16); rows inside a section sit 24px apart, label 14/20 500 with a
 *  13/18 secondary description, control at the right end. */

export function SettingsHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-[26px] font-semibold leading-8 text-neutral-900 dark:text-neutral-100">{title}</h1>
      {subtitle && <p className="text-base leading-6 text-neutral-900 dark:text-neutral-100">{subtitle}</p>}
    </header>
  );
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 border-b border-neutral-200/80 pb-3 text-base font-medium text-neutral-900 dark:border-neutral-700 dark:text-neutral-100">
        {title}
      </div>
      <div className="flex w-full flex-col gap-6">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="min-w-[200px] flex-[3]">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium leading-5 text-neutral-900 dark:text-neutral-100">{label}</div>
          {description && (
            <div className="text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400">{description}</div>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-end">{children}</div>
    </div>
  );
}
