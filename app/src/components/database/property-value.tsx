"use client";

import { Check } from "lucide-react";
import type { DbProperty, DbRow } from "@/lib/db/schema";
import { findOption, personLabels } from "@/lib/db-values";
import { useDb } from "./database-block";
import { UserAvatar } from "@/components/user-avatar";
import { OptionChip } from "./option-chip";

/** Read-only rendering of a property value (for List / Gallery / Calendar). */
export function PropertyValue({ prop, row }: { prop: DbProperty; row: DbRow }) {
  const db = useDb();
  const v = row.values[prop.id];

  switch (prop.type) {
    case "select":
    case "status": {
      const o = findOption(prop, v);
      return o ? <OptionChip color={o.color} title={o.name}>{o.name}</OptionChip> : null;
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
    case "date":
      return v ? <span className="text-xs text-neutral-500">{String(v)}</span> : null;
    default:
      return v ? (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">{String(v)}</span>
      ) : null;
  }
}
