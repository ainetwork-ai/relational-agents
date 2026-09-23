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

/** The ten colour keys Notion stores on an option. Backgrounds and label colours
 * differ per theme and live as CSS tokens in `globals.css` (`--chip-<key>-bg` /
 * `-text`, light on `:root`, dark on `.dark`) so a chip repaints the moment the
 * theme flips — measured in both themes on app.notion.com
 * (`e2e/fixtures/notion-chips.json` §colors / §colorsDark, 2026-08-06 / 2026-09-09).
 * Before that the chip carried the light literals only, and in dark mode drew
 * near-black text on a near-black overlay. The status dot is the one thing that
 * did not change between themes, so it stays a literal here.
 *
 * `default` is what Notion stores for Status's "Not started" — its CHIP paints
 * exactly like gray in both themes, but the colour menu lists 기본 and 회색 as
 * two rows with two swatches, so the two names must survive storage. */
export const CHIP_COLOR_KEYS = [
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
] as const;
export type ChipColorKey = (typeof CHIP_COLOR_KEYS)[number];

const DOT: Record<ChipColorKey, string> = {
  default: "rgb(142, 139, 134)",
  gray: "rgb(142, 139, 134)",
  brown: "rgb(158, 111, 78)",
  orange: "rgb(217, 115, 13)",
  yellow: "rgb(216, 163, 47)",
  green: "rgb(70, 161, 113)",
  blue: "rgb(39, 131, 222)",
  purple: "rgb(155, 81, 224)",
  pink: "rgb(224, 62, 143)",
  red: "rgb(229, 100, 88)",
};

export function chipColorKey(color?: string): ChipColorKey {
  return (CHIP_COLOR_KEYS as readonly string[]).includes(color ?? "") ? (color as ChipColorKey) : "gray";
}

export function chipColors(color?: string) {
  const k = chipColorKey(color);
  return { bg: `var(--chip-${k}-bg)`, text: `var(--chip-${k}-text)`, dot: DOT[k] };
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
      data-color={chipColorKey(color)}
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
