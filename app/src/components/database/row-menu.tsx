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
import { useDb } from "./database-block";
import { IconPicker } from "@/components/page/icon-picker";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";

// ===========================================================================
// The menu behind a row's ⠿ handle. Its items are the original's, read off the
// row menu there: 즐겨찾기에 추가 · 아이콘 편집 · 속성 편집 · 다음에서 열기 ·
// 댓글 ⌘⇧M · 링크 복사 · 복제 ⌘D · 옮기기 ⌘⇧P · 휴지통으로 이동 Del, and the
// last-edited line at the bottom. What we can't do yet is present but disabled,
// with the reason on hover, rather than missing.
// ===========================================================================

function fmtEdited(at: string | Date | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const editedAt = fmtEdited(row.updatedAt ?? row.createdAt);

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
        label="즐겨찾기에 추가"
        disabled="행 즐겨찾기는 아직 없습니다"
      />
      <div className="relative">
        <Item
          testid="row-menu-icon"
          icon={<Smile size={15} />}
          label="아이콘 편집"
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
        label="속성 편집"
        onClick={() => {
          db.openRow(row.id);
          onClose();
        }}
      />
      <Item
        testid="row-menu-open"
        icon={<PanelRight size={15} />}
        label="사이드 보기"
        onClick={() => {
          db.openRow(row.id);
          onClose();
        }}
      />
      <Divider />
      <Item
        testid="row-menu-comment"
        icon={<MessageSquare size={15} />}
        label="댓글"
        shortcut="⌘⇧M"
        disabled="행 댓글은 아직 없습니다"
      />
      <Item
        testid="row-menu-copy-link"
        icon={<LinkIcon size={15} />}
        label="링크 복사"
        onClick={pageId ? copyLink : undefined}
        disabled={pageId ? undefined : "이 행에는 아직 페이지가 없습니다"}
      />
      <Item
        testid="row-menu-duplicate"
        icon={<Copy size={15} />}
        label="복제"
        shortcut="⌘D"
        onClick={duplicate}
      />
      <Item
        testid="row-menu-move"
        icon={<CornerUpRight size={15} />}
        label="옮기기"
        shortcut="⌘⇧P"
        disabled="다른 데이터베이스로 옮기기는 아직 없습니다"
      />
      <Divider />
      <Item
        testid="row-menu-delete"
        icon={<Trash2 size={15} />}
        label="휴지통으로 이동"
        shortcut="Del"
        danger
        onClick={() => {
          db.deleteRow(row.id);
          onClose();
        }}
      />
      {(editedBy || editedAt) && (
        <div className="mt-1 border-t border-neutral-100 px-3 pb-1 pt-1.5 text-[11px] leading-tight text-neutral-400 dark:border-neutral-700">
          {editedBy && <div>{editedBy} 최종 편집</div>}
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
