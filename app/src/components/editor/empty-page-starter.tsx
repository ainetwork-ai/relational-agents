"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Sparkles, FileText, Table2, ClipboardList, LayoutTemplate } from "lucide-react";
import type { BlockType } from "@/lib/db/schema";
import { useT } from "@/i18n/provider";

interface StarterItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** what to convert the empty first block into */
  type?: BlockType;
  preset?: Record<string, unknown>;
  /** why it is disabled, shown as the tooltip */
  soon?: string;
}

/**
 * The 시작하기 row Notion shows on a brand-new empty page.
 *
 * Items we cannot honour are rendered disabled with a reason rather than left
 * out: the row is a menu of what a page can become, and silently dropping three
 * of five entries would misrepresent both this app and the design being copied.
 */
const ITEMS: StarterItem[] = [
  {
    key: "ai",
    label: "AI에게 질문하기",
    icon: <Sparkles size={15} />,
    soon: "LLM 엔드포인트가 아직 설정되지 않았습니다",
  },
  {
    key: "ai-note",
    label: "AI 노트",
    icon: <FileText size={15} />,
    soon: "AI 노트는 아직 없습니다",
  },
  {
    key: "database",
    label: "데이터베이스",
    icon: <Table2 size={15} />,
    type: "database",
  },
  {
    key: "form",
    label: "폼",
    icon: <ClipboardList size={15} />,
    soon: "폼은 아직 없습니다",
  },
  // 템플릿 opens the page-template list this editor already ships
  { key: "template", label: "템플릿", icon: <LayoutTemplate size={15} /> },
];

export function EmptyPageStarter({
  onPick,
  onTemplates,
}: {
  onPick: (type: BlockType, preset?: Record<string, unknown>) => void;
  onTemplates: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<number | null>(null);

 // The original pins this menu to the BOTTOM of the visible area, not under
 // the first line (page_add_popup.html: `top: calc(-442px + 100vh)` with
 // `padding-bottom: min(48px, 5vh)`). Its 100vh math assumes the layout
 // starts at the viewport top; ours starts wherever the title block ends —
 // and in a peek the visible bottom is the panel's, not the window's — so
 // measure instead: bottom of the nearest scroller, minus the padding,
 // minus this menu's own height, expressed in the editor's coordinates.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = el.offsetParent as HTMLElement | null; // editor-root (relative)
    if (!host) return;
    const update = () => {
      let sc: HTMLElement | null = host;
      while (sc && sc !== document.body) {
        const o = getComputedStyle(sc).overflowY;
        if (o === "auto" || o === "scroll") break;
        sc = sc.parentElement;
      }
      const visibleBottom =
        sc && sc !== document.body
          ? sc.getBoundingClientRect().top + sc.clientHeight
          : window.innerHeight;
      const pad = Math.min(48, window.innerHeight * 0.05);
      const t = visibleBottom - pad - el.offsetHeight - host.getBoundingClientRect().top;
      setTop(Math.max(0, Math.round(t)));
    };
    update();
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(host);
 // the content column above (title/cover) growing moves the editor down
    if (host.parentElement) ro.observe(host.parentElement);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="empty-page-starter"
      role="menu"
      aria-label={t("시작하기")}
      className="absolute inset-x-0 transition-[top] duration-200"
      style={top === null ? { visibility: "hidden", top: 0 } : { top }}
    >
      <p className="px-1 pb-1.5 text-sm font-medium text-neutral-400">{t("시작하기")}</p>
      <div className="flex flex-wrap gap-2">
        {ITEMS.map((item) => {
          const isTemplate = item.key === "template";
          const disabled = !item.type && !isTemplate;
          return (
            <button
              key={item.key}
              role="menuitem"
              data-testid={`starter-${item.key}`}
              disabled={disabled}
              title={item.soon ? t(item.soon) : undefined}
              aria-disabled={disabled}
              onClick={() => {
                if (isTemplate) return onTemplates();
                if (item.type) onPick(item.type, item.preset);
              }}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span className="text-neutral-400">{item.icon}</span>
              {t(item.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
