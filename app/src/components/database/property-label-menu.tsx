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
 * of its rows. Both measured on the original 2026-08-28 (row `X 관리 + Telegram
 * EN/KR (Round 1)`, fixtures/notion-row-props-band.json §labelMenu / §editPopover):
 *
 *   메뉴 220×168, radius 10, 라벨 왼쪽에 맞춰 라벨 아래 1px. 항목 28×212 (좌우 4
 *   여백), radius 6, 아이콘 20 at x8, 글자 x36 14px/400 rgb(44,44,43), 항목 사이 1.
 *   구분선 1px rgba(42,28,0,0.07) 이 댓글 뒤와 속성 삭제 뒤에 각각 위아래 4px 을 두고.
 *
 *   편집 팝오버 290×253: 이름 줄(타입 아이콘 28×28 at x12, 입력 x54 14px, ⓘ x256.7),
 *   그 아래 28px 줄 네 개 (유형 · 제한 · 기본값 · 알림, 아이콘 20 at x8, 값과 chevron
 *   오른쪽), 구분선, 속성 복제 · 속성 삭제.
 *
 * 제한 · 기본값 · 알림 · 속성 복제 · ⓘ 는 원본에 있지만 우리에게 없는 기능이라
 * 비활성으로 그린다 — 빼버리면 원본을 잘못 옮기는 것이 된다 (속성 추가 팝오버와 같은 규칙).
 */

const MENU_SHADOW =
  "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px";
const HOVER = "hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700";
const TEXT = "text-[rgb(44,44,43)] dark:text-neutral-200";

const TYPE_LABEL: Record<string, string> = {
  text: "텍스트", number: "숫자", select: "선택", multi_select: "다중 선택", status: "상태",
  date: "날짜", person: "사람", files: "파일과 미디어", checkbox: "체크박스", url: "URL",
  email: "이메일", phone: "전화번호", formula: "수식", relation: "관계형", rollup: "롤업",
  created_time: "생성 일시", last_edited_time: "최종 편집 일시", created_by: "생성자",
  last_edited_by: "최종 편집자",
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

/** 속성 표시 여부 — what the panel's submenu sets. The band never asks: a pinned
 *  property keeps its slot however empty it is (fixtures §set.emptyKeepsSlot). */
export type PageVisibility = "always" | "hide_empty" | "never";
const VISIBILITY: { value: PageVisibility; label: string }[] = [
  { value: "always", label: "항상 표시" },
  { value: "hide_empty", label: "비어있을 때 숨기기" },
  { value: "never", label: "항상 숨기기" },
];

export function PropertyLabelMenu({
  prop,
  anchor,
  onClose,
 // the band's menu and the 속성 panel's are different lists in the original:
 // the band has 댓글, the panel has 속성 표시 여부 · 속성 복제 instead
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
 // the 속성 표시 여부 row's box, so the submenu can hang off it
  const [subAnchor, setSubAnchor] = useState<DOMRect | null>(null);
  useDismiss(true, onClose, boxRef, subRef);
  const visibility: PageVisibility =
    (prop.config?.pageVisibility as PageVisibility | undefined) ?? "always";

 // 라벨 왼쪽에 맞춰 라벨 아래 1px; 창 밖으로 나가면 안쪽으로 당긴다
  const width = view === "edit" ? 290 : view === "layout" ? 260 : 220;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
 // The measured position is 1px under the label. A long list (레이아웃 사용자
 // 지정 on a database with many properties) would run off the bottom from
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
          {/* 이름 줄 — 타입 아이콘, 이름 입력, ⓘ */}
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
          <Row icon={<RefreshCw size={16} />} label={t("유형")} value={t(TYPE_LABEL[prop.type] ?? prop.type)} chevron disabled />
          <Row icon={<Hash size={16} />} label={t("제한")} value={t("제한 없음")} chevron disabled />
          <Row icon={<UserCircle2 size={16} />} label={t("기본값")} value={t("기본값 없음")} chevron disabled />
          <Row icon={<Bell size={16} />} label={t("알림")} value={t("사용자만")} chevron disabled />
          <Separator air={7} />
          <Row icon={<Copy size={16} />} label={t("속성 복제")} disabled />
          <Row
            icon={<Trash2 size={16} />}
            label={t("속성 삭제")}
            testid="db-prop-edit-delete"
            onClick={() => { db.deleteProperty(prop.id); onClose(); }}
          />
        </>
      ) : (
        <>
          <Row icon={<Pencil size={16} />} label={t("이름 바꾸기")} testid="db-prop-menu-rename" onClick={() => setView("edit")} />
          <Row icon={<SlidersHorizontal size={16} />} label={t("속성 편집")} testid="db-prop-menu-edit" onClick={() => setView("edit")} />
          {surface === "band" ? (
            <>
              <Row icon={<MessageSquare size={16} />} label={t("댓글")} disabled />
              <Separator />
            </>
          ) : (
            <>
              <Separator />
              <Row
                icon={<Eye size={16} />}
                label={t("속성 표시 여부")}
                chevron
                testid="db-prop-menu-visibility"
                onMouseEnter={(box) => setSubAnchor(box)}
                onClick={(box) => setSubAnchor((cur) => (cur ? null : box))}
              />
              <Row icon={<Copy size={16} />} label={t("속성 복제")} disabled />
            </>
          )}
          <Row icon={<Trash2 size={16} />} label={t("속성 삭제")} testid="db-prop-menu-delete"
            onClick={() => { db.deleteProperty(prop.id); onClose(); }} />
          <Separator />
          <Row
            icon={<LayoutPanelLeft size={16} />}
            label={t("레이아웃 사용자 지정")}
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
             // 원본은 패널이 창 오른쪽에 붙어 있어 왼쪽으로 펼친다: 하위 메뉴의
             // 오른쪽 끝이 부모 메뉴 왼쪽 +4, 위쪽은 누른 줄보다 33 위
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
