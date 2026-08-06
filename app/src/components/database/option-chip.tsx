"use client";

import { optionClass } from "@/lib/db-values";

/**
 * One select / status / multi-select value.
 *
 * The capture draws these as a fixed-height chip that stays on ONE line and
 * clips with an ellipsis (`docs/target.html`: height 20px, padding-inline
 * 7/9px, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`,
 * `max-width: 100%`). Ours had none of that, so a long option name —
 * "Strongly Exceeds Expectation" — wrapped to three lines, and since the chip
 * carries the colour, the whole cell turned into a 52px block of purple that
 * bled over the rows above and below it.
 *
 * h-5 fixes the thickness (20px, the same as before: 16px line + 2px padding),
 * and min-w-0/max-w-full let it shrink inside a narrow column rather than push
 * the column wider.
 */
export function OptionChip({
  color,
  children,
  title,
}: {
  color: string;
  children: React.ReactNode;
  /** hover text — the full name, since the chip itself may be clipped */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 min-w-0 max-w-full items-center rounded px-1.5 text-xs font-medium ${optionClass(color)}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
