/** Notion's .notion-page-controls glyphs (아이콘 추가 · 커버 추가 · 댓글 추가),
 *  paths lifted verbatim from docs/page_add_popup.html so they match the
 *  original instead of a platform emoji. Filled with currentColor, 16px. */
import type { SVGProps } from "react";

const base = { "aria-hidden": true, role: "graphics-symbol", width: 16, height: 16, fill: "currentColor" } as const;

export function EmojiFaceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} viewBox="2.37 2.37 15.26 15.25" className="shrink-0" {...props}>
      <path d="M2.375 10a7.625 7.625 0 1 1 15.25 0 7.625 7.625 0 0 1-15.25 0m5.67 1.706a.625.625 0 0 0-1.036.698A3.6 3.6 0 0 0 10.005 14c1.245 0 2.35-.637 2.996-1.596a.625.625 0 0 0-1.036-.698 2.37 2.37 0 0 1-1.96 1.044 2.36 2.36 0 0 1-1.96-1.044m-.68-2.041c.49 0 .88-.46.88-1.02s-.39-1.02-.88-1.02-.88.46-.88 1.02.39 1.02.88 1.02m6.15-1.02c0-.56-.39-1.02-.88-1.02s-.88.46-.88 1.02.39 1.02.88 1.02.88-.46.88-1.02" />
    </svg>
  );
}

export function PhotoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} viewBox="2.37 4.12 15.25 11.75" className="shrink-0" {...props}>
      <path d="M2.375 6.25c0-1.174.951-2.125 2.125-2.125h11c1.174 0 2.125.951 2.125 2.125v7.5a2.125 2.125 0 0 1-2.125 2.125h-11a2.125 2.125 0 0 1-2.125-2.125zm1.25 7.5c0 .483.392.875.875.875h11a.875.875 0 0 0 .875-.875v-2.79l-2.87-2.87a.625.625 0 0 0-.884 0l-4.137 4.135-1.98-1.98a.625.625 0 0 0-.883 0L3.625 12.24zM8.5 9.31a1.5 1.5 0 0 0 1.33-.805 1.094 1.094 0 0 1-.702-2.058A1.5 1.5 0 1 0 8.5 9.31" />
    </svg>
  );
}

export function CommentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} viewBox="2.37 3.13 15.25 14.86" className="shrink-0" {...props}>
      <path d="M17.625 5.255A2.125 2.125 0 0 0 15.5 3.13h-11a2.125 2.125 0 0 0-2.125 2.125v7.5c0 1.173.951 2.125 2.125 2.125h1.188v2.482a.625.625 0 0 0 1.006.496l3.87-2.978H15.5a2.125 2.125 0 0 0 2.125-2.125zM5.95 7.505a.55.55 0 0 1 .55-.55h7a.55.55 0 0 1 0 1.1h-7a.55.55 0 0 1-.55-.55m.55 2.45h5a.55.55 0 0 1 0 1.1h-5a.55.55 0 1 1 0-1.1" />
    </svg>
  );
}
