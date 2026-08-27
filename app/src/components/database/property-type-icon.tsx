"use client";

import type React from "react";

import {
  AlignLeft,
  ArrowLeftRight,
  AtSign,
  Calendar,
  CaseSensitive,
  CircleChevronDown,
  Clock,
  Hash,
  Link as LinkIcon,
  List,
  Paperclip,
  Phone,
  Repeat,
  Sigma,
  SquareCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { PropertyType } from "@/lib/db/schema";

/**
 * The little icon in front of a property's name.
 *
 * What each type shows was read off app.notion.com's own header row, magnified
 * (e2e/fixtures/notion-header-icons.json): every one is 16x16 in
 * rgb(142,139,134), 9px in from the cell's left with 7px to the label. Ours were
 * text glyphs at 10px ("Aa", "#", "⊙"), which is why the header did not read
 * like the original's.
 *
 *   title  Aa          text  three left-aligned lines   person  two busts
 *   date   calendar    created_time  clock              number  #
 *   select circle + ▾  multi_select  bulleted list      status  dashed circle
 *
 * These are lucide's icons chosen to match what the original draws, not Notion's
 * own artwork: at 16px they read the same, but Notion's are filled shapes where
 * lucide's are stroked, so the weight differs slightly. Copying their paths
 * verbatim would be exact — that is a call for whoever owns the product, not a
 * detail to decide inside a component.
 *
 * The types below the measured nine (checkbox, url, email, phone, files,
 * formula, relation, rollup) are not in the Projects table, so their icons are
 * our best match rather than something measured.
 */
type TypeIcon = LucideIcon | ((p: { size?: number; strokeWidth?: number; className?: string }) => React.JSX.Element);
const ICONS: Partial<Record<PropertyType, TypeIcon>> = {
  title: CaseSensitive,
  text: AlignLeft,
  person: Users,
  created_by: Users,
  last_edited_by: Users,
  date: Calendar,
  created_time: Clock,
  last_edited_time: Clock,
  number: Hash,
  select: CircleChevronDown,
  status: BurstIcon,
  multi_select: List,
  checkbox: SquareCheck,
  url: LinkIcon,
  email: AtSign,
  phone: Phone,
  files: Paperclip,
  formula: Sigma,
  relation: ArrowLeftRight,
  rollup: Repeat,
};

/** Status — the original's `burst_gray.svg`: eight radial strokes on a 20
 *  grid (read off the Projects page's filter chip, 2026-08-27). lucide had a
 *  dashed circle here, which reads as "loading", not "status". */
function BurstIcon({ size = 16, className = "" }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width={size} height={size} fill="currentColor" className={className}>
      <path d="M10.938 5.982v-3.17H9.062v3.17zm2.566 1.84 2.241-2.241-1.326-1.326-2.24 2.241zm3.683 3.116h-3.17V9.062h3.17zm-5.009 2.566 2.241 2.241 1.326-1.326-2.241-2.24zm-3.116 3.684v-3.17h1.875v3.17zm-2.566-5.01-2.241 2.241 1.326 1.326 2.24-2.241zM2.813 9.063h3.17v1.874h-3.17zm5.009-2.567L5.58 4.255 4.255 5.58l2.24 2.24z" />
    </svg>
  );
}

export function PropertyTypeIcon({
  type,
  className = "",
  size = 16,
  tone = "muted",
}: {
  type: PropertyType;
  className?: string;
  size?: number;
  /** "current" takes the surrounding text colour — a filter chip paints its
   *  type icon in the chip's own blue */
  tone?: "muted" | "current";
}) {
  const Icon = ICONS[type] ?? AlignLeft;
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      className={`shrink-0 ${tone === "muted" ? "text-[#8e8b86] dark:text-neutral-500" : ""} ${className}`}
    />
  );
}
