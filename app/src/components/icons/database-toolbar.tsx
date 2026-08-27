import type { SVGProps } from "react";

/* The database toolbar's and rule row's glyphs, traced from the original's
 * markup (docs/target.html and the Projects page over CDP, 2026-08-27). Every
 * one is a 16-unit grid; the rule-row ones are shown 14px tall through a
 * cropped viewBox, exactly as the original crops them. Fill is currentColor. */

/** filterSmall — three shortening lines, NOT a funnel (16×16 in the toolbar) */
export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width={16} height={16} fill="currentColor" {...props}>
      <path d="M2.4 3.7a.7.7 0 1 0 0 1.4h11.2a.7.7 0 1 0 0-1.4zm9.5 3.594H4.1a.7.7 0 1 0 0 1.4h7.8a.7.7 0 1 0 0-1.4M5.8 10.9a.7.7 0 1 0 0 1.4h4.4a.7.7 0 1 0 0-1.4z" />
    </svg>
  );
}

/** arrowUpDown — the toolbar's 정렬 (16×16) */
export function SortIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width={16} height={16} fill="currentColor" {...props}>
      <path d="M11.348 2.672a.625.625 0 0 0-.884 0L7.666 5.471a.625.625 0 1 0 .884.883l1.731-1.73v8.262a.625.625 0 1 0 1.25 0V4.623l1.732 1.731a.625.625 0 0 0 .884-.883zM5.093 2.49a.625.625 0 0 0-.625.624v8.263L2.737 9.646a.625.625 0 1 0-.884.883l2.798 2.799c.244.244.64.244.884 0l2.798-2.798a.625.625 0 0 0-.884-.884l-1.73 1.73V3.115a.625.625 0 0 0-.626-.625" />
    </svg>
  );
}

/** arrowChevronSingleDownSmall — the ⌄ on a chip (8.64×14: viewBox cropped to the glyph) */
export function ChevronSmallIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden viewBox="3.06 0 9.88 16" width={8.64} height={14} fill="currentColor" {...props}>
      <path d="m12.76 6.52-4.32 4.32a.62.62 0 0 1-.44.18.62.62 0 0 1-.44-.18L3.24 6.52a.63.63 0 0 1 0-.88c.24-.24.64-.24.88 0L8 9.52l3.88-3.88c.24-.24.64-.24.88 0s.24.64 0 .88" />
    </svg>
  );
}

/** plusSmall — the + of `+ 필터` (9.2×14, cropped) */
export function PlusSmallIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden viewBox="2.74 0 10.52 16" width={9.2} height={14} fill="currentColor" {...props}>
      <path d="M8 2.74a.66.66 0 0 1 .66.66v3.94h3.94a.66.66 0 0 1 0 1.32H8.66v3.94a.66.66 0 0 1-1.32 0V8.66H3.4a.66.66 0 0 1 0-1.32h3.94V3.4A.66.66 0 0 1 8 2.74" />
    </svg>
  );
}

/** arrowStraightUp/Down on a sort chip (7.95×14, cropped). The original's chip
 *  uses the `FillSmall` variant, whose path the captures do not hold; this is
 *  the outline arrow from the same set, flipped for up. */
export function SortArrowIcon({ dir, ...props }: { dir: "asc" | "desc" } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      viewBox="3.46 0 9.09 16"
      width={7.95}
      height={14}
      fill="currentColor"
      style={dir === "asc" ? { transform: "scaleY(-1)" } : undefined}
      {...props}
    >
      <path d="M3.757 8.758a.626.626 0 0 0 0 .885l3.801 3.8c.244.243.64.243.884 0l3.8-3.8a.626.626 0 0 0-.884-.885L8.625 11.49V3a.625.625 0 0 0-1.25 0v8.491L4.642 8.758a.626.626 0 0 0-.885 0" />
    </svg>
  );
}
