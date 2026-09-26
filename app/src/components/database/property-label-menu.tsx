"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pencil, SlidersHorizontal, MessageSquare, Trash2, LayoutPanelLeft, ChevronRight, Copy, Bell, Hash, UserCircle2, RefreshCw, Info, Eye, Check } from "lucide-react";
import type { DbProperty, PropertyType } from "@/lib/db/schema";
import { useDb } from "./database-block";
import { useDismiss } from "@/hooks/use-dismiss";
import { useT } from "@/i18n/provider";
import { PropertyTypeIcon } from "./property-type-icon";
import { CustomizeLayoutList } from "./customize-layout";

/**
 * The menu a pinned property's LABEL opens, and the property editor behind two
 * of its rows. Both measured on the original 2026-08-28 (the `X admin + Telegram
 * EN/KR (Round 1)` row, fixtures/notion-row-props-band.json §labelMenu / §editPopover):
 *
 *   Menu 220×168, radius 10, left-aligned with the label, 1px under it. Items 28×212
 *   (4 margin each side), radius 6, icon 20 at x8, text x36 14px/400 rgb(44,44,43), 1 between items.
 *   Dividers 1px rgba(42,28,0,0.07) after Comment and after Delete property, 4px above and below each.
 *
 *   Edit popover 290×253: name row (type icon 28×28 at x12, input x54 14px, ⓘ x256.7),
 *   then four 28px rows (Type · Limit · Default value · Notify, icon 20 at x8, value and
 *   chevron on the right), a divider, Duplicate property · Delete property.
 *
 * Limit · Default value · Notify · Duplicate property · ⓘ are in the original but are features
 * we lack, so they are drawn disabled — leaving them out would copy the original wrong (the
 * same rule as the Add-a-property popover).
 */

const MENU_SHADOW =
  "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px";
const HOVER = "hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700";
const TEXT = "text-[rgb(44,44,43)] dark:text-neutral-200";

const TYPE_LABEL: Record<string, string> = {
  text: "Text", number: "Number", select: "Select", multi_select: "Multi-select", status: "Status",
  date: "Date", person: "Person", files: "Files & media", checkbox: "Checkbox", url: "URL",
  email: "Email", phone: "Phone", formula: "Formula", relation: "Relational", rollup: "Rollup",
  created_time: "Created time", last_edited_time: "Last edited time", created_by: "Created by",
  last_edited_by: "Last edited by",
};

function Row({
  icon, label, value, chevron, disabled, onClick, onMouseEnter, testid, danger, trailing,
}: {
  icon: ReactNode; label: string; value?: string; chevron?: boolean;
  disabled?: boolean; onClick?: (box: DOMRect) => void; onMouseEnter?: (box: DOMRect) => void;
  testid?: string; danger?: boolean; trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      disabled={disabled}
      onMouseEnter={onMouseEnter ? (e) => onMouseEnter(e.currentTarget.getBoundingClientRect()) : undefined}
      onClick={onClick ? (e) => onClick(e.currentTarget.getBoundingClientRect()) : undefined}
      className={`flex h-7 w-full items-center rounded-[6px] px-2 text-[14px] font-normal leading-5 ${
        disabled ? "cursor-default opacity-40" : HOVER
      } ${danger ? "text-[rgb(235,87,87)]" : TEXT}`}
    >
      {icon !== null && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[rgb(142,139,134)]">{icon}</span>
      )}
      <span className={`${icon !== null ? "ml-2" : ""} truncate`}>{label}</span>
      {value && <span className="ml-auto truncate pl-2 text-[rgb(142,139,134)]">{value}</span>}
      {trailing && <span className="ml-auto shrink-0 pl-2 text-[rgb(142,139,134)]">{trailing}</span>}
      {chevron && <ChevronRight size={14} className={`${value ? "ml-1" : "ml-auto"} shrink-0 text-[rgb(142,139,134)]`} />}
    </button>
  );
}

/** 1px hairline with 4px of air above and below, the way the original spaces it. */
const Separator = ({ air = 3 }: { air?: number }) => (
 // `air` plus the list's 1px gap on each side is the space the original leaves:
 // 4 in the label menu, 8 in the editor popover
  <div
    data-role="menu-separator"
    style={{ marginTop: air, marginBottom: air }}
    className="h-px bg-[rgba(42,28,0,0.07)] dark:bg-neutral-700"
  />
);

/** Property visibility — what the panel's submenu sets. The band never asks: a pinned
 *  property keeps its slot however empty it is (fixtures §set.emptyKeepsSlot). */
export type PageVisibility = "always" | "hide_empty" | "never";
const VISIBILITY: { value: PageVisibility; label: string }[] = [
  { value: "always", label: "Always show" },
  { value: "hide_empty", label: "Hide when empty" },
  { value: "never", label: "Always hide" },
];

export function PropertyLabelMenu({
  prop,
  anchor,
  onClose,
 // the band's menu and the Properties panel's are different lists in the original:
 // the band has Comment, the panel has Property visibility · Duplicate property instead
  surface = "band",
}: {
  prop: DbProperty;
  anchor: DOMRect;
  onClose: () => void;
  surface?: "band" | "panel";
}) {
  const db = useDb();
  const t = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"menu" | "edit" | "layout">("menu");
 // the Property visibility row's box, so the submenu can hang off it
  const [subAnchor, setSubAnchor] = useState<DOMRect | null>(null);
  useDismiss(true, onClose, boxRef, subRef);
  const visibility: PageVisibility =
    (prop.config?.pageVisibility as PageVisibility | undefined) ?? "always";

 // left-aligned with the label, 1px under it; pulled back inside if it would leave the window
  const width = view === "edit" ? 290 : view === "layout" ? 260 : 220;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
 // The measured position is 1px under the label. A long list (Customize
 // layout on a database with many properties) would run off the bottom from
 // there, so the box is capped to the room it has and scrolls inside; when the
 // label sits low enough that the room below is not worth having, it opens
 // upward instead.
  const MARGIN = 8;
  const roomBelow = window.innerHeight - (anchor.bottom + 1) - MARGIN;
  const roomAbove = anchor.top - 1 - MARGIN;
  const flip = roomBelow < 240 && roomAbove > roomBelow;
  const place = flip
    ? { bottom: window.innerHeight - anchor.top + 1, maxHeight: roomAbove }
    : { top: anchor.bottom + 1, maxHeight: roomBelow };

  const menu = createPortal(
    <div
      ref={boxRef}
      role="menu"
      data-testid={
        view === "edit" ? "db-prop-edit-popover" : view === "layout" ? "db-peek-layout-menu" : "db-prop-label-menu"
      }
      style={{ left, width, boxShadow: MENU_SHADOW, ...place }}
      className={`popover-anim fixed z-50 flex flex-col gap-px overflow-y-auto rounded-[10px] bg-white dark:bg-neutral-800 ${
        view === "menu" ? "p-1" : "p-2"
      }`}
    >
      {view === "layout" ? (
        <CustomizeLayoutList />
      ) : view === "edit" ? (
        <>
          {/* name row — type icon, name input, ⓘ */}
          <div className="mb-4 mt-1 flex h-7 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[rgb(142,139,134)]">
              <PropertyTypeIcon type={prop.type} size={20} className="text-current" />
            </span>
            <input
              autoFocus
              data-testid="db-prop-edit-name"
              defaultValue={prop.name}
              onChange={(e) => db.updateProperty(prop.id, { name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onClose()}
              className={`h-5 min-w-0 flex-1 bg-transparent text-[14px] outline-none ${TEXT}`}
            />
            <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center text-[rgb(142,139,134)] opacity-40">
              <Info size={15} />
            </span>
          </div>
          <Row icon={<RefreshCw size={16} />} label={t("Type")} value={t(TYPE_LABEL[prop.type] ?? prop.type)} chevron disabled />
          <Row icon={<Hash size={16} />} label={t("Limit")} value={t("No limit")} chevron disabled />
          <Row icon={<UserCircle2 size={16} />} label={t("Default value")} value={t("No default")} chevron disabled />
          <Row icon={<Bell size={16} />} label={t("Notifications")} value={t("Members only")} chevron disabled />
          <Separator air={7} />
          <Row icon={<Copy size={16} />} label={t("Duplicate property")} disabled />
          <Row
            icon={<Trash2 size={16} />}
            label={t("Delete property")}
            testid="db-prop-edit-delete"
            onClick={() => { db.deleteProperty(prop.id); onClose(); }}
          />
        </>
      ) : (
        <>
          <Row icon={<Pencil size={16} />} label={t("Rename")} testid="db-prop-menu-rename" onClick={() => setView("edit")} />
          <Row icon={<SlidersHorizontal size={16} />} label={t("Edit property")} testid="db-prop-menu-edit" onClick={() => setView("edit")} />
          {surface === "band" ? (
            <>
              <Row icon={<MessageSquare size={16} />} label={t("Comments")} disabled />
              <Separator />
            </>
          ) : (
            <>
              <Separator />
              <Row
                icon={<Eye size={16} />}
                label={t("Property visibility")}
                chevron
                testid="db-prop-menu-visibility"
                onMouseEnter={(box) => setSubAnchor(box)}
                onClick={(box) => setSubAnchor((cur) => (cur ? null : box))}
              />
              <Row icon={<Copy size={16} />} label={t("Duplicate property")} disabled />
            </>
          )}
          <Row icon={<Trash2 size={16} />} label={t("Delete property")} testid="db-prop-menu-delete"
            onClick={() => { db.deleteProperty(prop.id); onClose(); }} />
          <Separator />
          <Row
            icon={<LayoutPanelLeft size={16} />}
            label={t("Customize layout")}
            testid="db-prop-menu-layout"
            onClick={() => setView("layout")}
          />
        </>
      )}
    </div>,
    document.body
  );

  return (
    <>
      {menu}
      {subAnchor &&
        createPortal(
          <div
            ref={subRef}
            role="menu"
            data-testid="db-prop-visibility-menu"
            style={{
             // the original's panel hugs the window's right edge, so it opens leftward: the
             // submenu's right edge is the parent menu's left +4, its top 33 above the pressed row
              left: Math.max(8, left + 4 - 180),
              top: Math.min(Math.max(8, subAnchor.top - 33), window.innerHeight - 94 - 8),
              width: 180,
              boxShadow: MENU_SHADOW,
            }}
            className="popover-anim fixed z-50 flex flex-col gap-px rounded-[10px] bg-white p-1 dark:bg-neutral-800"
          >
            {VISIBILITY.map((v) => (
              <Row
                key={v.value}
                icon={null}
                label={t(v.label)}
                testid={`db-prop-visibility-${v.value}`}
                trailing={visibility === v.value ? <Check size={14} /> : null}
                onClick={() => {
                  db.updateProperty(prop.id, {
                    config: { ...prop.config, pageVisibility: v.value },
                  });
                  onClose();
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

/** The label itself: a button that opens the menu and wears the original's
 *  hover wash, kept pressed while its menu is open. */
export function usePropertyLabelMenu() {
  const [openFor, setOpenFor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const openAt = (id: string, el: HTMLElement | null) => {
    if (!el) return;
    setOpenFor((cur) => (cur?.id === id ? null : { id, rect: el.getBoundingClientRect() }));
  };
  return { openFor, openAt, close: () => setOpenFor(null) };
}

export type { PropertyType };
