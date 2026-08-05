"use client";

import { Sparkles, FileText, Table2, ClipboardList, LayoutTemplate } from "lucide-react";
import type { BlockType } from "@/lib/db/schema";

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
  return (
    <div data-testid="empty-page-starter" role="menu" aria-label="시작하기" className="mt-1">
      <p className="px-1 pb-1.5 text-sm font-medium text-neutral-400">시작하기</p>
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
              title={item.soon}
              aria-disabled={disabled}
              onClick={() => {
                if (isTemplate) return onTemplates();
                if (item.type) onPick(item.type, item.preset);
              }}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <span className="text-neutral-400">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
