"use client";

import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Smile,
  SlidersHorizontal,
  PanelRight,
  MessageSquare,
  Link as LinkIcon,
  Copy,
  CornerUpRight,
  Trash2,
} from "lucide-react";
import type { DbRow } from "@/lib/db/schema";
import { personLabel } from "@/lib/db-values";
import { formatRowTimestamp } from "@/lib/dates";
import { useDb } from "./database-block";
import { IconPicker } from "@/components/page/icon-picker";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useIntlLocale, useT } from "@/i18n/provider";

// ===========================================================================
// The menu behind a row's ⠿ handle. Its items are the original's, read off the
// row menu there: Add to Favorites · Edit icon · Edit property · Open in ·
// Comment ⌘⇧M · Copy link · Duplicate ⌘D · Move to ⌘⇧P · Move to Trash Del, and the
// last-edited line at the bottom. What we can't do yet is present but disabled,
// with the reason on hover, rather than missing.
// ===========================================================================


export function RowMenu({
  row,
  triggerRef,
  onClose,
}: {
  row: DbRow;
 /** the ⠿ handle: the menu hangs off ITS box, not off where the pointer was,
  * so the same handle always opens the menu in the same place (and counts as
  * "inside" for dismissal, which is what lets a second click close it) */
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const db = useDb();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const pageId = typeof row.values.__page === "string" ? row.values.__page : null;
  const icon = typeof row.values.__icon === "string" ? row.values.__icon : null;
  useAnchored(true, triggerRef, ref, { gap: 4, margin: 8 });
  useDismiss(true, onClose, ref, triggerRef);

  const duplicate = () => {
    const values = { ...row.values };
    delete values.__page; // the copy gets its own page, not a second link to this one
    void db.addRow(values);
    onClose();
  };

  const copyLink = () => {
    if (!pageId) return;
    void navigator.clipboard?.writeText(`${location.origin}/p/${pageId}`);
    onClose();
  };

  const editedBy = personLabel(db.members, row.updatedBy ?? row.createdBy);
  const editedAt = formatRowTimestamp(row.updatedAt ?? row.createdAt, useIntlLocale());

  return createPortal(
    <div
      ref={ref}
      data-testid={`db-row-menu-${row.id}`}
 // hidden until useAnchored has placed it, or the first paint lands at 0,0.
 // overflow-y-auto so a window too short to hold the menu scrolls it instead
 // of cutting it off.
      style={{ visibility: "hidden" }}
      className="popover-anim fixed z-50 w-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
    >
      <Item
        testid="row-menu-favorite"
        icon={<Star size={15} />}
        label={t("Add to Favorites")}
        disabled={t("No favorited rows yet")}
      />
      <div className="relative">
        <Item
          testid="row-menu-icon"
          icon={<Smile size={15} />}
          label={t("Edit icon")}
          onClick={() => setIconOpen((v) => !v)}
          trailing={icon ?? undefined}
        />
        {iconOpen && (
          <div className="absolute left-2 top-8 z-50">
            <IconPicker
              icon={icon}
              onChange={(next) => {
                db.updateRow(row.id, { __icon: next });
                setIconOpen(false);
                onClose();
              }}
              testid={`row-icon-${row.id}`}
              pickerTestid="row-icon-picker"
              triggerClassName="hidden"
            />
          </div>
        )}
      </div>
      <Item
        testid="row-menu-properties"
        icon={<SlidersHorizontal size={15} />}
        label={t("Edit property")}
        onClick={() => {
          db.openRow(row.id);
          onClose();
        }}
      />
      <Item
        testid="row-menu-open"
        icon={<PanelRight size={15} />}
        label={t("Side Peek")}
        onClick={() => {
          db.openRow(row.id);
          onClose();
        }}
      />
      <Divider />
      <Item
        testid="row-menu-comment"
        icon={<MessageSquare size={15} />}
        label={t("Comments")}
        shortcut="⌘⇧M"
        disabled={t("No row comments yet")}
      />
      <Item
        testid="row-menu-copy-link"
        icon={<LinkIcon size={15} />}
        label={t("Copy link")}
        onClick={pageId ? copyLink : undefined}
        disabled={pageId ? undefined : t("No pages in this row yet")}
      />
      <Item
        testid="row-menu-duplicate"
        icon={<Copy size={15} />}
        label={t("Duplicate")}
        shortcut="⌘D"
        onClick={duplicate}
      />
      <Item
        testid="row-menu-move"
        icon={<CornerUpRight size={15} />}
        label={t("Move")}
        shortcut="⌘⇧P"
        disabled={t("Moving to another database isn't available yet")}
      />
      <Divider />
      <Item
        testid="row-menu-delete"
        icon={<Trash2 size={15} />}
        label={t("Move to Trash")}
        shortcut="Del"
        danger
        onClick={() => {
          db.deleteRow(row.id);
          onClose();
        }}
      />
      {(editedBy || editedAt) && (
        <div className="mt-1 border-t border-neutral-100 px-3 pb-1 pt-1.5 text-[11px] leading-tight text-neutral-400 dark:border-neutral-700">
          {editedBy && <div>{t("Last edited by {name}", { name: editedBy })}</div>}
          {editedAt && <div>{editedAt}</div>}
        </div>
      )}
    </div>,
    document.body
  );
}

function Divider() {
  return <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />;
}

function Item({
  testid,
  icon,
  label,
  shortcut,
  trailing,
  onClick,
  disabled,
  danger,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  trailing?: string;
  onClick?: () => void;
  /** the reason it can't be used — shown on hover, and the item goes grey */
  disabled?: string;
  danger?: boolean;
}) {
  return (
    <button
      data-testid={testid}
      onClick={disabled ? undefined : onClick}
      disabled={!!disabled}
      title={disabled}
      data-tip={disabled}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed text-neutral-300 dark:text-neutral-600"
          : danger
            ? "text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="text-base leading-none">{trailing}</span>}
      {shortcut && <span className="shrink-0 text-[11px] text-neutral-400">{shortcut}</span>}
    </button>
  );
}
