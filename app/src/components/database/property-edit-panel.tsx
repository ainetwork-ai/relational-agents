"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { createPortal } from "react-dom";
import type { DbProperty, PropertyConfig, SelectOption } from "@/lib/db/schema";
import { COLOR_CYCLE } from "@/lib/db-values";
import { newId } from "@/lib/compat";
import { useDismiss } from "@/hooks/use-dismiss";
import { useDb } from "./database-block";
import { OptionChip } from "./option-chip";
import { PropertyTypeIcon } from "./property-type-icon";
import { useT } from "@/i18n/provider";

// ===========================================================================
// 속성 편집 — the panel the Status menu's "속성 편집" row opens.
//
// Every number was read off app.notion.com with the panel open (2026-08-10,
// scratchpad/status-edit-capture/*): the original is NOT a popover but a
// sidebar docked under the view toolbar — `position:absolute; top:40px` inside
// the sticky toolbar row, white, no shadow, a 1px left border whose top 12px
// fade from the background, sliding in over 200ms, reaching the bottom of the
// viewport. Its left edge sits 387px left of the toolbar's right edge; the
// content column is 290 wide and the rest is the panel's own right gutter.
//
//   0    header, 50 tall: ← 16px at x15, "속성 편집" 14px/600 at x43,
//        ✕ 20×20 circle (bg rgba(42,28,0,.07), 14px mark) at right x255
//   54   name row: type icon in a 28×28 1px-bordered button at x13, then the
//        name input in a 215×28 box — bg rgba(66,35,3,.03), ring
//        rgba(28,19,1,.11), radius 6, ⓘ at its right edge
//   98   유형 row 259×28 at x9: 20px icon, label, then "상태 ›" in
//        rgb(161,158,153) — display only here; changing a type is not built
//   137  group label row 251×20 at x13 (pad 0 8): 12px/500 rgb(125,122,117)
//        + a 20×20 옵션 추가 button at its right edge
//   166  option rows 259×28 at x9, radius 6, hover rgba(33,27,23,.051):
//        ⠿ 16px at x19 (drag to reorder), the chip at x43, then — on the
//        default option — "기본" 12px/500 rgb(161,158,153), and › 16px at x244
//        · rows in a group stack with no gap; the next label comes 10px later
//   ...  (+ 옵션 추가 swaps in a 28px row holding an input, "새 옵션을 입력하세요")
//   -132 fixed footer: 1px rule 258 wide at x17, then four 274×28 rows at x9 —
//        콘텐츠 줄바꿈하기 (30×18 switch) · 다음과 같이 표시: 선택 › · 속성
//        복제 · 속성 삭제 — and 8px under them
//
// Clicking an option opens a 220-wide menu at the pointer's x, dropping UP
// when the space below runs out (measured: bottom lands on the row's top):
// name input (all selected), 삭제, 기본으로 설정, 그룹화 → a 250-wide list of
// the three groups with ✓ on the current one, a rule, "색", then 기본 + nine
// colours as 18×18 radius-4 swatches with ✓ on the current colour.
//
// What this panel does not do yet: change the property's type (유형 row) and
// the "다음과 같이 표시" submenu — both render as the original draws them but
// don't open anything. 콘텐츠 줄바꿈하기 persists to config.wrapContent only.
// ===========================================================================

const TEXT = "rgb(44, 44, 43)"; // --c-texPri
const TEXT_TER = "rgb(161, 158, 153)"; // right-hand values, 기본 tag
const LABEL = "rgb(125, 122, 117)"; // group labels, section labels
const ICON = "rgb(85, 83, 78)"; // menu row icons (burst icon measured)
const ICON_SEC = "rgb(142, 139, 134)"; // drag handle, ✕ mark
const HOVER = "rgba(33, 27, 23, 0.051)";
const RULE = "rgba(42, 28, 0, 0.07)";
const RING = "rgba(28, 19, 1, 0.11)"; // 1px ring on the name input boxes
const INPUT_BG = "rgba(66, 35, 3, 0.03)";
const BTN_BORDER = "rgba(42, 28, 0, 0.07)"; // icon button border (--ca-borPriTra)
const BLUE = "rgb(35, 131, 226)";
const SHADOW =
  "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px";

/** the original's Korean UI for the three canonical group names */
const GROUP_LABEL: Record<string, string> = {
  "To-do": "할 일",
  "In progress": "진행 중",
  Complete: "완료",
};

/** the colour menu, in the original's order — swatches read off it, and the
 * swatch for 기본 is NOT the default chip's bg (the chip paints like gray) */
const COLOR_MENU: { key: string; label: string; swatch: string }[] = [
  { key: "default", label: "기본", swatch: "rgba(42, 28, 0, 0.07)" },
  { key: "gray", label: "회색", swatch: "rgba(28, 19, 1, 0.11)" },
  { key: "brown", label: "갈색", swatch: "rgba(127, 51, 0, 0.157)" },
  { key: "orange", label: "주황색", swatch: "rgba(196, 88, 0, 0.204)" },
  { key: "yellow", label: "노란색", swatch: "rgba(209, 156, 0, 0.282)" },
  { key: "green", label: "초록색", swatch: "rgba(0, 96, 38, 0.157)" },
  { key: "blue", label: "파란색", swatch: "rgba(0, 118, 217, 0.204)" },
  { key: "purple", label: "보라색", swatch: "rgba(92, 0, 163, 0.14)" },
  { key: "pink", label: "분홍색", swatch: "rgba(183, 0, 78, 0.153)" },
  { key: "red", label: "빨간색", swatch: "rgba(206, 24, 0, 0.165)" },
];

// Notion's own artwork, copied path-for-path out of the captured panel/menu
// HTML — lucide equivalents read close but weigh differently at 16/20px.
const PATHS: Record<string, { vb: string; d: string[] }> = {
  back: { vb: "0 0 16 16", d: ["M7.242 12.243a.626.626 0 0 1-.884 0l-3.8-3.801a.625.625 0 0 1 0-.884l3.8-3.8a.626.626 0 0 1 .884.884L4.51 7.375H13a.625.625 0 1 1 0 1.25H4.51l2.733 2.733a.626.626 0 0 1 0 .885"] },
  x: { vb: "0 0 16 16", d: ["M12.642 3.358a.625.625 0 0 0-.884 0L8 7.116 4.242 3.358a.625.625 0 1 0-.884.884L7.116 8l-3.758 3.758a.625.625 0 0 0 .884.884L8 8.884l3.758 3.758a.625.625 0 1 0 .884-.884L8.884 8l3.758-3.758a.625.625 0 0 0 0-.884"] },
  info: { vb: "2.37 0 15.26 20", d: ["M2.375 10a7.625 7.625 0 1 1 15.25 0 7.625 7.625 0 0 1-15.25 0M8.65 8.25a.625.625 0 1 0 0 1.25h.725v3.25H8.65a.625.625 0 1 0 0 1.25h2.7a.625.625 0 1 0 0-1.25h-.725V8.875A.625.625 0 0 0 10 8.25zM10.7 6.3a.8.8 0 1 0-1.6 0 .8.8 0 0 0 1.6 0"] },
  type: { vb: "0 0 20 20", d: ["M6.475 3.125a.625.625 0 1 0 0 1.25h7.975c.65 0 1.175.526 1.175 1.175v6.057l-1.408-1.408a.625.625 0 1 0-.884.884l2.475 2.475a.625.625 0 0 0 .884 0l2.475-2.475a.625.625 0 0 0-.884-.884l-1.408 1.408V5.55a2.425 2.425 0 0 0-2.425-2.425zM3.308 6.442a.625.625 0 0 1 .884 0l2.475 2.475a.625.625 0 1 1-.884.884L4.375 8.393v6.057c0 .649.526 1.175 1.175 1.175h7.975a.625.625 0 0 1 0 1.25H5.55a2.425 2.425 0 0 1-2.425-2.425V8.393L1.717 9.801a.625.625 0 1 1-.884-.884z"] },
  chevron: { vb: "0 0 16 16", d: ["M6.722 3.238a.625.625 0 1 0-.884.884L9.716 8l-3.878 3.878a.625.625 0 0 0 .884.884l4.32-4.32a.625.625 0 0 0 0-.884z"] },
  plus: { vb: "0 0 20 20", d: ["M10 3.59a.66.66 0 0 1 .66.66v5.09h5.09a.66.66 0 0 1 0 1.32h-5.09v5.09a.66.66 0 0 1-1.32 0v-5.09H4.25a.66.66 0 0 1 0-1.32h5.09V4.25a.66.66 0 0 1 .66-.66"] },
  drag: { vb: "0 0 16 16", d: ["M4.8 3.2a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0m4 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0m1.2 6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4M4.8 8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0m5.2 6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4m-5.2-1.2a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0"] },
  wrap: { vb: "0 0 20 20", d: ["M16.625 8A2.625 2.625 0 0 0 14 5.375h-1.42a.625.625 0 1 1 0-1.25H14a3.875 3.875 0 0 1 0 7.75H4.259l3.333 3.333a.625.625 0 0 1-.884.884l-4.4-4.4a.625.625 0 0 1 0-.884l4.4-4.4a.625.625 0 0 1 .884.884l-3.333 3.333H14A2.625 2.625 0 0 0 16.625 8"] },
  eye: { vb: "0 0 20 20", d: ["M10.17 6.694a3.307 3.307 0 0 1 3.135 3.303l-.005.17a3.305 3.305 0 0 1-3.3 3.137l-.17-.004a3.307 3.307 0 0 1-3.132-3.133l-.004-.17A3.307 3.307 0 0 1 10 6.69zm-.17 2.2a1.104 1.104 0 0 0 0 2.207 1.103 1.103 0 0 0 0-2.207", "M10 4.194c3.878 0 7.26 2.075 8.862 5.127l.073.163c.126.333.126.7 0 1.033l-.073.163c-1.602 3.052-4.984 5.126-8.862 5.126-3.757 0-7.049-1.946-8.707-4.843l-.156-.283a1.46 1.46 0 0 1 0-1.359l.156-.283C2.95 6.141 6.243 4.194 10 4.194m0 1.251c-3.33 0-6.196 1.724-7.622 4.214l-.134.243a.21.21 0 0 0 0 .197l.134.243c1.426 2.49 4.292 4.214 7.622 4.214 3.437 0 6.38-1.837 7.756-4.457l.018-.048a.2.2 0 0 0 0-.1l-.018-.049C16.38 7.282 13.437 5.445 10 5.445"] },
  duplicate: { vb: "0 0 20 20", d: ["M4.5 2.375A2.125 2.125 0 0 0 2.375 4.5V12c0 1.174.951 2.125 2.125 2.125h1.625v1.625c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125v-7.5a2.125 2.125 0 0 0-2.125-2.125h-1.625V4.5A2.125 2.125 0 0 0 12 2.375zm8.375 3.75H8.25A2.125 2.125 0 0 0 6.125 8.25v4.625H4.5A.875.875 0 0 1 3.625 12V4.5c0-.483.392-.875.875-.875H12c.483 0 .875.392.875.875zm-5.5 2.125c0-.483.392-.875.875-.875h7.5c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875z"] },
  trash: { vb: "0 0 20 20", d: ["M8.806 8.505a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0zm3.488 0a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0z", "M6.386 3.925v1.464H3.523a.625.625 0 1 0 0 1.25h.897l.393 8.646A2.425 2.425 0 0 0 7.236 17.6h5.528a2.425 2.425 0 0 0 2.422-2.315l.393-8.646h.898a.625.625 0 1 0 0-1.25h-2.863V3.925c0-.842-.683-1.525-1.525-1.525H7.91c-.842 0-1.524.683-1.524 1.525M7.91 3.65h4.18c.15 0 .274.123.274.275v1.464H7.636V3.925c0-.152.123-.275.274-.275m-.9 2.99h7.318l-.39 8.588a1.175 1.175 0 0 1-1.174 1.122H7.236a1.175 1.175 0 0 1-1.174-1.122l-.39-8.589z"] },
  flag: { vb: "0 0 20 20", d: ["M10.282 3.66a5.39 5.39 0 0 0-5.217-.54l-.711.305a.63.63 0 0 0-.38.575v12.425a.625.625 0 1 0 1.25 0v-3.913l.333-.142a4.14 4.14 0 0 1 4.008.414 5.39 5.39 0 0 0 5.504.405l1.06-.53a.63.63 0 0 0 .346-.56V4a.625.625 0 0 0-.905-.558l-1.06.53c-1.36.68-2.983.56-4.228-.312m-5.057 7.495V4.412l.332-.142a4.14 4.14 0 0 1 4.008.413 5.39 5.39 0 0 0 5.504.406l.156-.078v6.703l-.715.357c-1.36.68-2.983.56-4.228-.312a5.4 5.4 0 0 0-5.057-.604"] },
  checkSquare: { vb: "0 0 20 20", d: ["M12.876 7.982a.625.625 0 1 0-1.072-.644L9.25 11.595 7.815 9.92a.625.625 0 1 0-.95.813l2 2.334a.625.625 0 0 0 1.01-.085z", "M5.25 3.125A2.125 2.125 0 0 0 3.125 5.25v9.5c0 1.174.951 2.125 2.125 2.125h9.5a2.125 2.125 0 0 0 2.125-2.125v-9.5a2.125 2.125 0 0 0-2.125-2.125zM4.375 5.25c0-.483.392-.875.875-.875h9.5c.483 0 .875.392.875.875v9.5a.875.875 0 0 1-.875.875h-9.5a.875.875 0 0 1-.875-.875z"] },
  check: { vb: "0 0 16 16", d: ["M11.834 3.309a.625.625 0 0 1 1.072.642l-5.244 8.74a.625.625 0 0 1-1.01.085L3.155 8.699a.626.626 0 0 1 .95-.813l2.93 3.419z"] },
};

function Icon({ name, size, color }: { name: keyof typeof PATHS; size: number; color: string }) {
  const p = PATHS[name];
  return (
    <svg
      aria-hidden="true"
      viewBox={p.vb}
      width={size}
      height={size}
      className="shrink-0"
      style={{ fill: color }}
    >
      {p.d.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

interface Group {
  id: string;
  name: string;
  optionIds: string[];
}

export function PropertyEditPanel({
  prop,
  /** the view-tabs/toolbar row — the panel docks under its bottom edge and
   * left of its right edge, like the original docks under its sticky toolbar */
  anchorRef,
  onClose,
}: {
  prop: DbProperty;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const db = useDb();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const options: SelectOption[] = prop.config.options ?? [];
  const groups: Group[] = (prop.config.optionGroups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    optionIds: g.optionIds,
  }));
  const byId = (id: string) => options.find((o) => o.id === id);
  // a canonical group shows its Korean name (translated); anything else is
  // the user's own name and shows as typed
  const groupLabel = (name: string) => (GROUP_LABEL[name] ? t(GROUP_LABEL[name]) : name);

  // ---- placement: docked under the toolbar row, out to the window's edge ----
  // The original's -387 is measured against a toolbar NODE that includes the
  // page's 96px right margin (its sidebar bleeds with inset -96 / padding 96).
  // Our view bar ends at the 새로 만들기 button, so the rule that survives the
  // translation is the visible one: the 290px menu column's right edge sits on
  // the toolbar's right edge (-291 = 290 + 1px border), and only the white
  // background continues to the window edge.
  const place = useCallback(() => {
    const bar = anchorRef.current;
    const el = panelRef.current;
    if (!bar || !el) return;
    const r = bar.getBoundingClientRect();
    el.style.top = `${Math.max(Math.round(r.bottom), 0)}px`;
    el.style.left = `${Math.round(r.right - 291)}px`;
    el.style.visibility = "visible";
  }, [anchorRef]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  // ---- config mutations: one whole-config PATCH, like every option write ----
  const patch = (mut: (cfg: PropertyConfig) => PropertyConfig) => {
    const cfg = structuredClone(prop.config);
    db.updateProperty(prop.id, { config: mut(cfg) });
  };

  // ---- option menu (click a row) ----
  const [menu, setMenu] = useState<{ optId: string; x: number; rowTop: number; rowBottom: number } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [groupSub, setGroupSub] = useState(false);
  const menuOpt = menu ? byId(menu.optId) : undefined;

  const commitRename = () => {
    if (!menu || !menuOpt) return;
    const name = nameDraft.trim();
    if (name && name !== menuOpt.name)
      patch((cfg) => {
        const o = cfg.options?.find((x) => x.id === menu.optId);
        if (o) o.name = name;
        return cfg;
      });
  };
  const closeMenu = () => {
    commitRename();
    setGroupSub(false);
    setMenu(null);
  };

  // one level per dismiss: the menu's own outside-click/Escape peels it (and
  // its group submenu) first; only with nothing above it does the panel close
  useDismiss(!!menu, () => (groupSub ? setGroupSub(false) : closeMenu()), menuRef, groupRef);
  const menuOpen = !!menu;
  useDismiss(
    true,
    useCallback(() => {
      if (menuOpen) return;
      onClose();
    }, [menuOpen, onClose]),
    panelRef,
    menuRef,
    groupRef
  );

  // ---- add-option input (the group's +) ----
  const [adding, setAdding] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const commitAdd = () => {
    const name = addDraft.trim();
    const gid = adding;
    setAdding(null);
    setAddDraft("");
    if (!name || !gid) return;
    const opt: SelectOption = {
      id: newId(),
      name,
      color: COLOR_CYCLE[(options.length ?? 0) % COLOR_CYCLE.length],
    };
    patch((cfg) => {
      cfg.options = [...(cfg.options ?? []), opt];
      const g = cfg.optionGroups?.find((x) => x.id === gid);
      // the input sits at the top of the group, and that is where the new
      // option lands
      if (g) g.optionIds = [opt.id, ...g.optionIds.filter((x) => x !== opt.id)];
      return cfg;
    });
  };

  // ---- drag to reorder (the ⠿ handle) ----
  const [drop, setDrop] = useState<{ groupId: string; index: number } | null>(null);
  const dragging = useRef<string | null>(null);
  const startDrag = (optId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = optId;
    const onMove = (ev: PointerEvent) => {
      const rows = panelRef.current?.querySelectorAll<HTMLElement>("[data-optrow]") ?? [];
      let next: { groupId: string; index: number } | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
        const gid = row.dataset.group!;
        const idx = Number(row.dataset.index);
        next = { groupId: gid, index: ev.clientY < r.top + r.height / 2 ? idx : idx + 1 };
        break;
      }
      setDrop(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const optId2 = dragging.current;
      dragging.current = null;
      setDrop((d) => {
        if (d && optId2)
          patch((cfg) => {
            const gs = cfg.optionGroups ?? [];
            const from = gs.find((g) => g.optionIds.includes(optId2));
            const to = gs.find((g) => g.id === d.groupId);
            if (from && to) {
              const oldIdx = from.optionIds.indexOf(optId2);
              from.optionIds = from.optionIds.filter((x) => x !== optId2);
              let at = d.index;
              if (from.id === to.id && oldIdx < at) at -= 1;
              to.optionIds.splice(Math.min(at, to.optionIds.length), 0, optId2);
            }
            return cfg;
          });
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---- menu actions ----
  const deleteOption = () => {
    if (!menu) return;
    const id = menu.optId;
    setGroupSub(false);
    setMenu(null);
    patch((cfg) => {
      cfg.options = (cfg.options ?? []).filter((o) => o.id !== id);
      cfg.optionGroups = cfg.optionGroups?.map((g) => ({
        ...g,
        optionIds: g.optionIds.filter((x) => x !== id),
      }));
      if (cfg.defaultOptionId === id) delete cfg.defaultOptionId;
      return cfg;
    });
  };
  const setDefault = () => {
    if (!menu) return;
    const id = menu.optId;
    patch((cfg) => ({ ...cfg, defaultOptionId: id }));
  };
  const moveToGroup = (gid: string) => {
    if (!menu) return;
    const id = menu.optId;
    setGroupSub(false);
    patch((cfg) => {
      const gs = cfg.optionGroups ?? [];
      for (const g of gs) g.optionIds = g.optionIds.filter((x) => x !== id);
      const to = gs.find((g) => g.id === gid);
      if (to) to.optionIds.push(id);
      return cfg;
    });
  };
  const setColor = (key: string) => {
    if (!menu) return;
    const id = menu.optId;
    patch((cfg) => {
      const o = cfg.options?.find((x) => x.id === id);
      if (o) o.color = key;
      return cfg;
    });
  };

  const duplicateProperty = async () => {
    const copy = await db.addProperty(`${prop.name} (1)`, prop.type);
    if (copy) db.updateProperty(copy.id, { config: structuredClone(prop.config) });
    onClose();
  };

  const menuGroup = menu ? groups.find((g) => g.optionIds.includes(menu.optId)) : undefined;

  // ---- the option menu popover, anchored at the pointer's x / the row's y ----
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const h = el.offsetHeight;
    const below = window.innerHeight - menu.rowBottom;
    const top = h <= below ? menu.rowBottom : Math.max(8, menu.rowTop - h);
    el.style.left = `${Math.min(menu.x - 1, window.innerWidth - 228)}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [menu, groupSub]);
  // the original opens with the option's name fully selected — autoFocus alone
  // left the caret at the end, so select explicitly, once per open
  useEffect(() => {
    if (menu) menuRef.current?.querySelector("input")?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.optId]);

  // the group submenu hangs under its row, right edges 4px apart (measured)
  const groupRowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = groupRef.current;
    const row = groupRowRef.current;
    if (!groupSub || !el || !row) return;
    const r = row.getBoundingClientRect();
    el.style.left = `${Math.round(r.right - 250)}px`;
    el.style.top = `${Math.round(r.bottom)}px`;
    el.style.visibility = "visible";
  }, [groupSub]);

  const menuItemCls =
    "mx-1 flex h-7 items-center rounded-[6px] px-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700";

  return createPortal(
    <>
      <div
        ref={panelRef}
        data-testid={`db-prop-edit-panel-${prop.id}`}
        style={{
          visibility: "hidden",
          borderLeft: `1px solid ${RULE}`,
          borderImage: `linear-gradient(180deg, #fff 0px, ${RULE} 12px) 1 100%`,
          animation: "prop-panel-in 200ms ease",
        }}
        className="fixed bottom-0 right-0 z-40 bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:[border-image:none]"
      >
        <div className="flex h-full w-[290px] flex-col">
          {/* header — offsets are measured from the original's border-box, and
              our 1px left border sits on the panel itself, so every left inset
              below is the original's minus 1 */}
          <div className="flex h-[50px] shrink-0 items-center pl-[10px] pr-4">
            <button
              data-testid="db-prop-edit-back"
              aria-label={t("뒤로")}
              onClick={onClose}
              className="flex h-[22px] w-6 items-center justify-center rounded-[6px] hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
            >
              <Icon name="back" size={16} color={ICON} />
            </button>
            <span
              className="ml-2 flex-1 truncate text-[14px] font-semibold"
              style={{ color: TEXT }}
            >
              {t("속성 편집")}
            </span>
            <button
              data-testid="db-prop-edit-close"
              aria-label={t("닫기")}
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{ background: RULE }}
            >
              <Icon name="x" size={14} color={ICON_SEC} />
            </button>
          </div>

          {/* scrollable middle */}
          <div className="min-h-0 flex-1 overflow-y-auto pt-1">
            {/* name row */}
            <div className="flex items-center gap-2 pl-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
                style={{ border: `1px solid ${BTN_BORDER}` }}
              >
                <PropertyTypeIcon type={prop.type} />
              </span>
              <div
                className="flex h-7 w-[215px] items-center rounded-[6px] px-[6px] py-[3px]"
                style={{ background: INPUT_BG, boxShadow: `${RING} 0px 0px 0px 1px` }}
              >
                <input
                  data-testid={`db-prop-edit-name-${prop.id}`}
                  placeholder={t("속성 이름")}
                  defaultValue={prop.name}
                  key={`name-${prop.name}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== prop.name) db.updateProperty(prop.id, { name: v });
                  }}
                  onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="h-5 w-full bg-transparent text-[14px] leading-5 outline-none dark:text-neutral-200"
                  style={{ color: TEXT }}
                />
                <Icon name="info" size={15} color={ICON_SEC} />
              </div>
            </div>

            {/* 유형 — display only; a type editor is not part of this panel yet */}
            <div
              className="ml-2 mt-4 flex h-7 w-[259px] items-center rounded-[6px] pl-2 pr-2 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
              role="button"
              tabIndex={0}
            >
              <Icon name="type" size={20} color={ICON} />
              <span className="ml-2 flex-1 text-[14px]" style={{ color: TEXT }}>
                {t("유형")}
              </span>
              <span className="text-[14px]" style={{ color: TEXT_TER }}>
                {t("상태")}
              </span>
              <span className="ml-[6px] flex items-center">
                <Icon name="chevron" size={16} color={TEXT_TER} />
              </span>
            </div>

            {/* groups */}
            {groups.map((g, gi) => {
              const opts = g.optionIds.map(byId).filter(Boolean) as SelectOption[];
              return (
                <div key={g.id} data-testid={`db-prop-edit-group-${g.id}`}>
                  <div
                    className={`ml-3 flex h-5 w-[251px] items-center px-2 ${gi === 0 ? "mt-[11px]" : "mt-[10px]"}`}
                  >
                    <span
                      className="text-[12px] font-medium leading-[14px]"
                      style={{ color: LABEL }}
                    >
                      {groupLabel(g.name)}
                    </span>
                    <button
                      data-testid={`db-prop-edit-add-option-${g.id}`}
                      aria-label={t("옵션 추가")}
                      onClick={() => {
                        setAdding(g.id);
                        setAddDraft("");
                      }}
                      className="ml-auto flex h-5 w-5 items-center justify-center rounded-[6px] hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
                    >
                      <Icon name="plus" size={20} color={LABEL} />
                    </button>
                  </div>
                  {/* label→rows: 9px on the first group, 8px on the rest — the
                      original's own rhythm (166/232/298, not an even step) */}
                  <div className={`${gi === 0 ? "mt-[9px]" : "mt-2"} flex flex-col`}>
                    {adding === g.id && (
                      <div className="ml-2 flex h-7 w-[259px] items-center">
                        <div
                          className="mx-3 flex h-7 w-full items-center rounded-[6px] px-[6px]"
                          style={{
                            background: INPUT_BG,
                            boxShadow: `${BLUE} 0px 0px 0px 1px, rgba(35, 131, 226, 0.25) 0px 0px 0px 3px`,
                          }}
                        >
                          <input
                            data-testid={`db-prop-edit-add-input-${g.id}`}
                            autoFocus
                            placeholder={t("새 옵션을 입력하세요")}
                            value={addDraft}
                            onChange={(e) => setAddDraft(e.target.value)}
                            onBlur={() => {
                              setAdding(null);
                              setAddDraft("");
                            }}
                            onKeyDown={(e) => {
                              if (!isImeComposing(e) && e.key === "Enter") commitAdd();
                              if (e.key === "Escape") {
                                e.stopPropagation();
                                setAdding(null);
                                setAddDraft("");
                              }
                            }}
                            className="h-5 w-full bg-transparent text-[14px] leading-5 outline-none dark:text-neutral-200"
                            style={{ color: TEXT }}
                          />
                        </div>
                      </div>
                    )}
                    {opts.map((o, i) => (
                      <div
                        key={o.id}
                        data-optrow
                        data-group={g.id}
                        data-index={i}
                        data-testid={`db-prop-edit-option-${o.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          setNameDraft(o.name);
                          setGroupSub(false);
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenu({ optId: o.id, x: e.clientX, rowTop: r.top, rowBottom: r.bottom });
                        }}
                        className="ml-2 flex h-7 w-[259px] cursor-pointer items-center rounded-[6px] pl-[10px] pr-2 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
                        style={
                          drop && drop.groupId === g.id && drop.index === i
                            ? { boxShadow: `0 -2px 0 ${BLUE}` }
                            : drop && drop.groupId === g.id && drop.index === i + 1 && i === opts.length - 1
                              ? { boxShadow: `0 2px 0 ${BLUE}` }
                              : undefined
                        }
                      >
                        <span
                          className="flex cursor-grab items-center"
                          onPointerDown={startDrag(o.id)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Icon name="drag" size={16} color={ICON_SEC} />
                        </span>
                        <span className="ml-2 min-w-0">
                          <OptionChip color={o.color ?? "default"} title={o.name} dot>
                            {o.name}
                          </OptionChip>
                        </span>
                        <span className="ml-auto flex items-center">
                          {prop.config.defaultOptionId === o.id && (
                            <span
                              className="mr-[6px] text-[12px] font-medium"
                              style={{ color: TEXT_TER }}
                            >
                              {t("기본")}
                            </span>
                          )}
                          <Icon name="chevron" size={16} color={TEXT_TER} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* fixed footer */}
          <div className="shrink-0 pb-2">
            <div className="ml-4 h-px w-[258px]" style={{ background: RULE }} />
            <div className="mt-2 flex flex-col gap-px">
              <div className="ml-2 flex h-7 w-[274px] items-center rounded-[6px] pl-2 pr-2 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700">
                <Icon name="wrap" size={20} color={ICON} />
                <span className="ml-2 flex-1 text-[14px]" style={{ color: TEXT }}>
                  {t("콘텐츠 줄바꿈하기")}
                </span>
                <button
                  data-testid={`db-prop-edit-wrap-${prop.id}`}
                  role="switch"
                  aria-checked={!!prop.config.wrapContent}
                  onClick={() => patch((cfg) => ({ ...cfg, wrapContent: !cfg.wrapContent }))}
                  className="relative h-[18px] w-[30px] rounded-full transition-colors"
                  style={{ background: prop.config.wrapContent ? BLUE : "rgba(135,131,120,0.3)" }}
                >
                  <span
                    className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-[left]"
                    style={{ left: prop.config.wrapContent ? 14 : 2 }}
                  />
                </button>
              </div>
              <div
                className="ml-2 flex h-7 w-[274px] items-center rounded-[6px] pl-2 pr-2 hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
                role="button"
                tabIndex={0}
              >
                <Icon name="eye" size={20} color={ICON} />
                <span className="ml-2 flex-1 text-[14px]" style={{ color: TEXT }}>
                  {t("다음과 같이 표시:")}
                </span>
                <span className="text-[14px]" style={{ color: TEXT_TER }}>
                  {t("선택")}
                </span>
                <span className="ml-[6px] flex items-center">
                  <Icon name="chevron" size={16} color={TEXT_TER} />
                </span>
              </div>
              <button
                data-testid={`db-prop-edit-duplicate-${prop.id}`}
                onClick={() => void duplicateProperty()}
                className="ml-2 flex h-7 w-[274px] items-center rounded-[6px] pl-2 pr-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
              >
                <Icon name="duplicate" size={20} color={ICON} />
                <span className="ml-2 text-[14px]" style={{ color: TEXT }}>
                  {t("속성 복제")}
                </span>
              </button>
              <button
                data-testid={`db-prop-edit-delete-${prop.id}`}
                onClick={() => {
                  db.deleteProperty(prop.id);
                  onClose();
                }}
                className="ml-2 flex h-7 w-[274px] items-center rounded-[6px] pl-2 pr-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
              >
                <Icon name="trash" size={20} color={ICON} />
                <span className="ml-2 text-[14px]" style={{ color: TEXT }}>
                  {t("속성 삭제")}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- option menu ---- */}
      {menu && menuOpt && (
        <div
          ref={menuRef}
          data-testid={`db-option-menu-${menu.optId}`}
          style={{ visibility: "hidden", width: 220, boxShadow: SHADOW }}
          className="popover-anim fixed z-50 rounded-[10px] bg-white dark:bg-neutral-800"
        >
          <div
            className="mx-3 mt-3 flex h-7 items-center rounded-[6px] px-[6px]"
            style={{ background: INPUT_BG, boxShadow: `${RING} 0px 0px 0px 1px` }}
          >
            <input
              data-testid={`db-option-menu-name-${menu.optId}`}
              autoFocus
              onFocus={(e) => e.target.select()}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && closeMenu()}
              className="h-5 w-full bg-transparent text-[14px] leading-5 outline-none dark:text-neutral-200"
              style={{ color: TEXT }}
            />
            <Icon name="info" size={15} color={ICON_SEC} />
          </div>
          <div className="mt-2 pb-1" role="menu">
            <div className="flex flex-col gap-px pt-1">
            <button
              data-testid={`db-option-menu-delete-${menu.optId}`}
              onClick={deleteOption}
              className={`${menuItemCls} gap-2`}
            >
              <Icon name="trash" size={20} color={ICON} />
              <span className="text-[14px]" style={{ color: TEXT }}>
                {t("삭제")}
              </span>
            </button>
            <button
              data-testid={`db-option-menu-default-${menu.optId}`}
              onClick={setDefault}
              className={`${menuItemCls} gap-2`}
            >
              <Icon name="flag" size={20} color={ICON} />
              <span className="text-[14px]" style={{ color: TEXT }}>
                {t("기본으로 설정")}
              </span>
            </button>
            <div
              ref={groupRowRef}
              data-testid={`db-option-menu-group-${menu.optId}`}
              role="button"
              tabIndex={0}
              onClick={() => setGroupSub((v) => !v)}
              className={`${menuItemCls} cursor-pointer gap-2`}
              style={groupSub ? { background: HOVER } : undefined}
            >
              <Icon name="checkSquare" size={20} color={ICON} />
              <span className="flex-1 text-[14px]" style={{ color: TEXT }}>
                {t("그룹화")}
              </span>
              <span className="text-[14px]" style={{ color: TEXT_TER }}>
                {menuGroup ? groupLabel(menuGroup.name) : ""}
              </span>
              <span className="ml-[6px] flex items-center">
                <Icon name="chevron" size={16} color={TEXT_TER} />
              </span>
            </div>
            </div>
            <div className="mx-3 mt-[9px] h-px" style={{ background: RULE }} />
            <div className="mx-3 mt-3 flex h-[14px] items-center">
              <span className="text-[12px] font-medium leading-[14px]" style={{ color: LABEL }}>
                {t("색")}
              </span>
            </div>
            <div className="mt-[10px] flex flex-col gap-px">
              {COLOR_MENU.map((c) => (
                <button
                  key={c.key}
                  data-testid={`db-option-menu-color-${c.key}`}
                  onClick={() => setColor(c.key)}
                  className={`${menuItemCls}`}
                >
                  <span
                    className="ml-px h-[18px] w-[18px] shrink-0 rounded-[4px]"
                    style={{ background: c.swatch }}
                  />
                  <span className="ml-[9px] flex-1 text-left text-[14px]" style={{ color: TEXT }}>
                    {t(c.label)}
                  </span>
                  {(menuOpt.color ?? "default") === c.key && (
                    <Icon name="check" size={16} color={ICON} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- group submenu ---- */}
      {menu && groupSub && (
        <div
          ref={groupRef}
          data-testid={`db-option-menu-groups-${menu.optId}`}
          style={{ visibility: "hidden", width: 250, boxShadow: SHADOW }}
          className="popover-anim fixed z-50 rounded-[10px] bg-white py-1 dark:bg-neutral-800"
        >
          <div className="flex flex-col gap-px" role="menu">
            {groups.map((g) => (
              <button
                key={g.id}
                data-testid={`db-option-menu-groups-${g.id}`}
                onClick={() => moveToGroup(g.id)}
                className="mx-1 flex h-7 items-center rounded-[6px] px-2 text-left hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-neutral-700"
              >
                <span className="flex-1 text-[14px]" style={{ color: TEXT }}>
                  {groupLabel(g.name)}
                </span>
                {menuGroup?.id === g.id && <Icon name="check" size={16} color={ICON} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
