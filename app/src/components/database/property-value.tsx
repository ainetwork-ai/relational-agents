"use client";

import { Check } from "lucide-react";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { findOption, personLabels } from "@/lib/db-values";
import { useDb } from "./database-block";
import { UserAvatar } from "@/components/user-avatar";
import { OptionChip } from "./option-chip";
import { parseDateValue } from "./date-picker";
import { DEFAULT_DATE_FORMAT, fmtDateRange, type DateFormat } from "@/lib/date-format";
import { useIntlLocale, useT } from "@/i18n/provider";
import { formatNumber } from "./property-cell";

/** Read-only rendering of a property value (for List / Gallery / Calendar). */
export function PropertyValue({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const t = useT();
  const intl = useIntlLocale();
  const db = useDb();
  const v = row.values[prop.id];

  switch (prop.type) {
    case "select":
    case "status": {
      const o = findOption(prop, v);
      return o ? (
        <OptionChip color={o.color} title={o.name} dot={prop.type === "status"}>
          {o.name}
        </OptionChip>
      ) : null;
    }
    case "multi_select": {
      const ids: string[] = Array.isArray(v) ? (v as string[]) : [];
      return (
        <span className="flex min-w-0 flex-wrap gap-1">
          {ids.map((id) => {
            const o = findOption(prop, id);
            return o ? (
              <OptionChip key={id} color={o.color} title={o.name}>
                {o.name}
              </OptionChip>
            ) : null;
          })}
        </span>
      );
    }
    case "person": {
      const people = personLabels(db.members, v);
      return people.length ? (
        <span className="flex flex-wrap items-center gap-1">
          {people.map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <UserAvatar user={{ displayName: p.label, avatarUrl: p.avatarUrl }} size={16} />
              <span className="text-xs text-neutral-600 dark:text-neutral-300">{p.label}</span>
            </span>
          ))}
        </span>
      ) : null;
    }
    case "checkbox":
      return v ? (
        <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-blue-500 text-white">
          <Check size={11} />
        </span>
      ) : (
        <span className="text-xs text-neutral-300">☐</span>
      );
    case "date": {
      const label = fmtDateRange(
        parseDateValue(v),
        (prop.config?.dateFormat as DateFormat) ?? DEFAULT_DATE_FORMAT,
        { locale: intl, t }
      );
      return label ? <span className="text-xs text-neutral-500">{label}</span> : null;
    }
    case "number": {
      // the column's format, as the table shows it (1,080,000, not 1080000)
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
      return Number.isFinite(n) ? (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {formatNumber(n, prop.config?.numberFormat as string | undefined, intl)}
        </span>
      ) : null;
    }
    default:
      return v ? (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">{String(v)}</span>
      ) : null;
  }
}
