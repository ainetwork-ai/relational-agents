"use client";

import {
  AlignLeft,
  ArrowLeftRight,
  AtSign,
  Calendar,
  CaseSensitive,
  CircleChevronDown,
  CircleDashed,
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
const ICONS: Partial<Record<PropertyType, LucideIcon>> = {
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
  status: CircleDashed,
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

export function PropertyTypeIcon({
  type,
  className = "",
}: {
  type: PropertyType;
  className?: string;
}) {
  const Icon = ICONS[type] ?? AlignLeft;
  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={`shrink-0 text-[#8e8b86] dark:text-neutral-500 ${className}`}
    />
  );
}
