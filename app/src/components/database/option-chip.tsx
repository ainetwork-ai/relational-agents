"use client";

import { OPTION_COLORS } from "@/lib/db-values";

/**
 * One select / status / multi-select value — the ONLY chip in the app.
 *
 * There used to be two: this one (a 12px square-ish chip) in the cells, and a
 * second one inside the Status menu built to the original's measurements. The
 * same value therefore looked like two different things depending on where you
 * were looking, so this is now the single component and the menu's shape is the
 * one that won:
 *
 *   height 20, radius 10 (a pill), padding-left 7 / right 9, label 14px
 *   status only: an 8px dot 5px before the label
 *
 * Those numbers were read off app.notion.com with a Status cell open and are
 * kept in `e2e/fixtures/notion-status-dropdown.json`; the cell and the menu
 * are compared against each other in `e2e/chip-consistency.check.mjs`, so the
 * two can no longer drift apart.
 *
 * Still one line, still clipped: the capture's table views all carry
 * `table_wrap: false`, and a chip that wraps turns the whole cell into a block
 * of colour that bleeds over its neighbours.
 */

/** Chip colours as measured in the original's Status menu (translucent
 *  overlays, hence the alpha). Only these five were on screen to sample —
 *  brown/orange/purple/pink fall through to `OPTION_COLORS`, our published-
 *  palette classes, and get no measured dot. */
const MEASURED: Record<string, { bg: string; dot: string; text: string }> = {
  gray: { bg: "rgba(28, 19, 1, 0.11)", dot: "rgb(142, 139, 134)", text: "rgb(73, 72, 70)" },
  blue: { bg: "rgba(0, 118, 217, 0.204)", dot: "rgb(39, 131, 222)", text: "rgb(38, 74, 114)" },
  red: { bg: "rgba(206, 24, 0, 0.165)", dot: "rgb(229, 100, 88)", text: "rgb(109, 53, 49)" },
  yellow: { bg: "rgba(209, 156, 0, 0.282)", dot: "rgb(216, 163, 47)", text: "rgb(101, 81, 33)" },
  green: { bg: "rgba(0, 96, 38, 0.157)", dot: "rgb(70, 161, 113)", text: "rgb(42, 83, 60)" },
};

export function chipColors(color?: string) {
  return MEASURED[color ?? "gray"];
}

export function OptionChip({
  color,
  children,
  title,
  dot = false,
}: {
  color: string;
  children: React.ReactNode;
  /** hover text — the full name, since the chip itself may be clipped */
  title?: string;
  /** the original draws a dot on status values, and only on those */
  dot?: boolean;
}) {
  const c = chipColors(color);
  return (
    <span
      title={title}
      data-chip={dot ? "status" : "option"}
      className={`inline-flex h-5 min-w-0 max-w-full items-center rounded-[10px] pl-[7px] pr-[9px] ${
        c ? "" : OPTION_COLORS[color] ?? OPTION_COLORS.gray
      }`}
      style={c ? { background: c.bg } : undefined}
    >
      {dot && (
        <span
          className="mr-[5px] h-2 w-2 shrink-0 rounded-full"
 // no sampled dot for an unmeasured colour: borrow the label's own tone rather
 // than leave a status chip dotless (our Status uses only the five above)
          style={{ background: c?.dot ?? "currentColor" }}
        />
      )}
      <span className="truncate text-[14px] leading-5" style={c ? { color: c.text } : undefined}>
        {children}
      </span>
    </span>
  );
}
