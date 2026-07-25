"use client";

import { Check } from "lucide-react";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { optionClass, findOption, personLabel } from "@/lib/db-values";
import { useDb } from "./database-block";
import { initial } from "@/lib/glyph";

/** Read-only rendering of a property value (for List / Gallery / Calendar). */
export function PropertyValue({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const v = row.values[prop.id];

  switch (prop.type) {
    case "select":
    case "status": {
      const o = findOption(prop, v);
      return o ? (
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${optionClass(o.color)}`}>
          {o.name}
        </span>
      ) : null;
    }
    case "multi_select": {
      const ids: string[] = Array.isArray(v) ? (v as string[]) : [];
      return (
        <span className="flex flex-wrap gap-1">
          {ids.map((id) => {
            const o = findOption(prop, id);
            return o ? (
              <span key={id} className={`rounded px-1.5 py-0.5 text-xs font-medium ${optionClass(o.color)}`}>
                {o.name}
              </span>
            ) : null;
          })}
        </span>
      );
    }
    case "person": {
      const label = personLabel(db.members, v);
      return label ? (
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-semibold text-white">
            {initial(label)}
          </span>
          <span className="text-xs text-neutral-600 dark:text-neutral-300">{label}</span>
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
    case "date":
      return v ? <span className="text-xs text-neutral-500">{String(v)}</span> : null;
    default:
      return v ? (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">{String(v)}</span>
      ) : null;
  }
}
