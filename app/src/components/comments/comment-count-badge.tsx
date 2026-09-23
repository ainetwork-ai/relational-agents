"use client";

import { forwardRef } from "react";
import { useT } from "@/i18n/provider";

/**
 * The mark a commented row wears in the table's title cell, straight from the
 * original (e2e/fixtures/notion-row-comments.json): a 16px filled bubble in
 * rgb(142,139,134) with 3px after it, then the count at 12px/14.4px in the
 * ordinary ink — the whole thing 20px tall, radius 4, 5px after the title.
 *
 * The icon is the original's own `commentFilledSmall` path, not a lookalike
 * from the icon set: at 16px the difference in the tail is visible, and this
 * badge sits right next to the title where it gets read closely.
 */
export const CommentCountBadge = forwardRef<
  HTMLSpanElement,
  { n: number; open?: boolean; onOpen: () => void }
>(function CommentCountBadge({ n, open, onOpen }, ref) {
  const t = useT();
  if (n <= 0) return null; // the original omits the badge entirely at zero
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      data-testid="comment-count-badge"
      aria-label={t("댓글 열기")}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
     // tabular figures: in the original a 1 and a 3 measure the same 33.56px,
     // so the badge does not resize as the count ticks over
      className={`ml-[5px] flex h-5 shrink-0 cursor-pointer items-center rounded-[4px] pl-[2px] pr-[5px] text-[12px] font-normal leading-[14.4px] text-[#2c2c2b] tabular-nums hover:bg-[rgba(33,27,23,0.051)] dark:text-neutral-300 dark:hover:bg-white/10 ${
        open ? "bg-[rgba(33,27,23,0.051)] dark:bg-white/10" : ""
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        width={16}
        height={16}
        aria-hidden="true"
        className="me-[3px] shrink-0 fill-[rgb(142,139,134)]"
      >
        <path d="M5.2 5.425a.575.575 0 0 0 0 1.15h5.6a.575.575 0 1 0 0-1.15zm0 2.4a.575.575 0 1 0 0 1.15h4a.575.575 0 1 0 0-1.15z" />
        <path d="M4 2.575c-1.036 0-1.875.84-1.875 1.875v5.5c0 1.036.84 1.875 1.875 1.875h.466v1.822a.625.625 0 0 0 1.019.485l2.84-2.307H12c1.036 0 1.875-.84 1.875-1.875v-5.5c0-1.035-.84-1.875-1.875-1.875zM3.375 4.45c0-.345.28-.625.625-.625h8c.345 0 .625.28.625.625v5.5c0 .345-.28.625-.625.625H8.102a.63.63 0 0 0-.394.14l-1.992 1.619V11.2a.625.625 0 0 0-.625-.625H4a.625.625 0 0 1-.625-.625z" />
      </svg>
      {n}
    </span>
  );
});
