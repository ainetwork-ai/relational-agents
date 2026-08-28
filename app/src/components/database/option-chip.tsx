"use client";

/**
 * One select / status / multi-select value — the ONLY chip in the app.
 *
 * Every number here was read off app.notion.com (`e2e/fixtures/notion-chips.json`,
 * procedure in `docs/notion-golden-set.md`), and the thing that measuring changed:
 * **the chip is not one shape.**
 *
 *   select / multi_select   height 20, radius 4,  padding 6 / 6,   no dot
 *   status                  height 20, radius 10, padding 7 / 9,   8px dot, 5px gap
 *
 * Both use a 14px/20px label at weight 400 over a translucent overlay. We drew
 * everything as the status pill, because the only thing measured before was the
 * Status menu — so an Evaluation value ("Strongly Exceeds Expectation") and a
 * Team value came out rounder and heavier than the original's, and purple/brown/
 * orange/pink had no measured colour at all and fell back to Tailwind.
 *
 * Still one line, still clipped: the capture's table views all carry
 * `table_wrap: false`, and a chip that wraps turns the whole cell into a block
 * of colour that bleeds over its neighbours.
 */

/** Chip colours as Notion paints them — translucent overlays, hence the alpha. */
const MEASURED: Record<string, { bg: string; text: string; dot: string }> = {
  // `default` is what Notion stores for Status's "Not started" — its CHIP paints
  // exactly like gray (measured on the property editor, 2026-08-10), but the
  // colour menu lists 기본 and 회색 as two rows with two swatches, so the two
  // names must survive storage to put the ✓ on the right row.
  default: { bg: "rgba(28, 19, 1, 0.11)", text: "rgb(73, 72, 70)", dot: "rgb(142, 139, 134)" },
  gray: { bg: "rgba(28, 19, 1, 0.11)", text: "rgb(73, 72, 70)", dot: "rgb(142, 139, 134)" },
  brown: { bg: "rgba(127, 51, 0, 0.157)", text: "rgb(88, 68, 55)", dot: "rgb(158, 111, 78)" },
  orange: { bg: "rgba(196, 88, 0, 0.204)", text: "rgb(106, 66, 34)", dot: "rgb(217, 115, 13)" },
  yellow: { bg: "rgba(209, 156, 0, 0.282)", text: "rgb(101, 81, 33)", dot: "rgb(216, 163, 47)" },
  green: { bg: "rgba(0, 96, 38, 0.157)", text: "rgb(42, 83, 60)", dot: "rgb(70, 161, 113)" },
  blue: { bg: "rgba(0, 118, 217, 0.204)", text: "rgb(38, 74, 114)", dot: "rgb(39, 131, 222)" },
  purple: { bg: "rgba(92, 0, 163, 0.14)", text: "rgb(85, 59, 105)", dot: "rgb(155, 81, 224)" },
  pink: { bg: "rgba(183, 0, 78, 0.153)", text: "rgb(104, 53, 78)", dot: "rgb(224, 62, 143)" },
  red: { bg: "rgba(206, 24, 0, 0.165)", text: "rgb(109, 53, 49)", dot: "rgb(229, 100, 88)" },
};

export function chipColors(color?: string) {
  return MEASURED[color ?? "gray"] ?? MEASURED.gray;
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
  /** status values only: the original draws a dot on those, and only on those */
  dot?: boolean;
}) {
  const c = chipColors(color);
  return (
    <span
      title={title}
      data-chip={dot ? "status" : "option"}
 // the two shapes, straight from the fixture
      className={`inline-flex h-5 min-w-0 max-w-full items-center ${
        dot ? "rounded-[10px] pl-[7px] pr-[9px]" : "rounded-[4px] px-[6px]"
      }`}
      style={{ background: c.bg }}
    >
      {dot && (
        <span
          className="mr-[5px] h-2 w-2 shrink-0 rounded-full"
          style={{ background: c.dot }}
        />
      )}
      <span
        className="truncate text-[14px] font-normal leading-5"
        style={{ color: c.text }}
      >
        {children}
      </span>
    </span>
  );
}
