"use client";

import { useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { usePathname } from "next/navigation";
import { Bold, Italic, Underline, Strikethrough, Code, Link as LinkIcon, Unlink, MessageSquarePlus, Palette, ChevronDown } from "lucide-react";

/** inline color palette (class-based so the sanitizer keeps it). */
const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

function wrapColor(cls: string) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const host = (
    sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
  )?.closest('[data-testid^="block-editable-"]') as HTMLElement | null;
  const text = sel.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;");
  document.execCommand("insertHTML", false, `<span class="${cls}">${text}</span>`);
  host?.dispatchEvent(new Event("input", { bubbles: true }));
}
import { useCommentsStore } from "@/stores/comments";
import { useEditor } from "./block-editor";
import { TURN_INTO } from "./block-row";
import { useT } from "@/i18n/provider";

/** Korean display names for the TURN_INTO entries (their labels live in
 * block-row and are English); anything unmapped falls back to that label. */
const TURN_INTO_KO: Record<string, string> = {
  paragraph: "텍스트",
  heading1: "제목1",
  heading2: "제목2",
  heading3: "제목3",
  bulleted_list: "글머리 기호 목록",
  numbered_list: "번호 매기기 목록",
  todo: "할 일 목록",
  toggle: "토글 목록",
  quote: "인용",
  callout: "콜아웃",
  code: "코드",
};

/** Korean color names for the palette's aria-labels (class names stay English). */
const COLOR_KO: Record<string, string> = {
  gray: "회색",
  brown: "갈색",
  orange: "주황색",
  yellow: "노란색",
  green: "초록색",
  blue: "파란색",
  purple: "보라색",
  pink: "분홍색",
  red: "빨간색",
};

interface ToolbarState {
  x: number;
  y: number;
}

function exec(
  cmd: "bold" | "italic" | "underline" | "strikeThrough" | "code" | "unlink"
) {
  document.execCommand("styleWithCSS", false, "false");
  if (cmd === "code") {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    document.execCommand(
      "insertHTML",
      false,
      `<code>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code>`
    );
  } else {
    document.execCommand(cmd, false);
  }
}

/**
 * Floating inline-format toolbar. Appears above a
 * non-collapsed selection inside the block editor; applies formats with
 * execCommand so the browser handles range splitting.
 */
export function SelectionToolbar({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const editor = useEditor();
  const t = useT();
  const [turnOpen, setTurnOpen] = useState(false);
  const [state, setState] = useState<ToolbarState | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const commentRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const addComment = useCommentsStore((s) => s.add);
  const barRef = useRef<HTMLDivElement>(null);
 // focusing the link input collapses the selection — save/restore the range
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (
        !sel ||
        sel.isCollapsed ||
        sel.rangeCount === 0 ||
        !container.current
      ) {
        setState(null);
        setLinkOpen(false);
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorEl =
        range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
 // only for selections inside an editable block of THIS editor
      if (!anchorEl?.closest('[data-testid^="block-editable-"]')) {
        setState(null);
        return;
      }
      if (!container.current.contains(anchorEl)) {
        setState(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setState(null);
        return;
      }
      setState({ x: rect.left + rect.width / 2, y: rect.top });
    };

    const onSelectionChange = () => {
 // ignore while interacting with the toolbar itself (link input focus)
      if (barRef.current?.contains(document.activeElement)) return;
      update();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [container]);

 // Cmd/Ctrl+E → inline code, Cmd/Ctrl+K with a selection → link.
 // Selection is computed LIVE — depending on `state` races the keystroke
 // that follows Ctrl+A before React commits the toolbar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const sel = window.getSelection();
      const anchor =
        sel?.anchorNode instanceof Element
          ? sel.anchorNode
          : sel?.anchorNode?.parentElement;
      if (
        !sel ||
        sel.isCollapsed ||
        !anchor?.closest('[data-testid^="block-editable-"]')
      ) {
        return;
      }
      const k = e.key.toLowerCase();
 // explicit text-format shortcuts (don't rely on browser defaults, which
 // are absent in some contexts): Cmd+B/I/U + Cmd+Shift+S for strike.
      if (k === "b") {
        e.preventDefault();
        exec("bold");
      } else if (k === "i") {
        e.preventDefault();
        exec("italic");
      } else if (k === "u") {
        e.preventDefault();
        exec("underline");
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault();
        exec("strikeThrough");
      } else if (k === "e") {
        e.preventDefault();
        exec("code");
      } else if (k === "k") {
        e.preventDefault();
        e.stopImmediatePropagation(); // keep the search modal closed
        const range = sel.getRangeAt(0);
        savedRangeRef.current = range.cloneRange();
        const rect = range.getBoundingClientRect();
        setState({ x: rect.left + rect.width / 2, y: rect.top });
        setLinkOpen(true);
        setTimeout(() => linkRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!state) return null;

  function applyLink(url: string) {
    const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
    const saved = savedRangeRef.current;
    setLinkOpen(false);
    savedRangeRef.current = null;
    if (!saved) return;

 // execCommand("createLink") silently no-ops while focus sits in the link
 // input — wrap the saved range directly instead.
    const a = document.createElement("a");
    a.setAttribute("href", href);
    try {
      saved.surroundContents(a);
    } catch {
 // range crosses element boundaries (partially formatted selection)
      a.appendChild(saved.extractContents());
      saved.insertNode(a);
    }
    const host = a.closest('[data-testid^="block-editable-"]') as HTMLElement | null;
    host?.dispatchEvent(new Event("input", { bubbles: true }));
  }

 // Inline range comment: highlight the selected text and anchor a comment to
 // the block that holds it.
  function submitRangeComment(body: string) {
    const saved = savedRangeRef.current;
    setCommentOpen(false);
    savedRangeRef.current = null;
    if (!saved || !body.trim()) return;
    const span = document.createElement("span");
    span.className = "comment-highlight";
    try {
      saved.surroundContents(span);
    } catch {
      span.appendChild(saved.extractContents());
      saved.insertNode(span);
    }
    const host = span.closest('[data-testid^="block-editable-"]') as HTMLElement | null;
    host?.dispatchEvent(new Event("input", { bubbles: true }));
    const blockId = host?.getAttribute("data-testid")?.replace("block-editable-", "") ?? null;
    const pageId = pathname?.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? null;
    if (pageId && blockId) void addComment(pageId, body.trim(), blockId);
  }

  return (
    <div
      ref={barRef}
      data-testid="format-toolbar"
      className="popover-anim fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.preventDefault() /* keep the text selection */}
    >
      <div className="flex items-center p-1">
        <ToolButton
          testid="format-ask-ai"
          label={t("AI에게 요청")}
          onClick={() => {
            const sel = window.getSelection();
            const host = (sel?.anchorNode instanceof Element
              ? sel.anchorNode
              : sel?.anchorNode?.parentElement
            )?.closest('[data-testid^="block-editable-"]') as HTMLElement | null;
            const blockId = host?.getAttribute("data-testid")?.replace("block-editable-", "");
            if (blockId) editor.insertAiPromptAfter(blockId);
          }}
        >
          <span className="px-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">✨ AI</span>
        </ToolButton>
        <div className="relative">
          <ToolButton
            testid="format-turninto"
            label={t("전환")}
            onClick={() => setTurnOpen((v) => !v)}
          >
            <span className="flex items-center gap-0.5 px-0.5 text-xs text-neutral-500">
              {t("전환")} <ChevronDown size={11} />
            </span>
          </ToolButton>
          {turnOpen && (
            <div className="popover-anim absolute left-0 top-8 z-50 max-h-64 w-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
              {TURN_INTO.map((opt) => (
                <button
                  key={opt.type}
                  data-testid={`format-turninto-${opt.type}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const sel = window.getSelection();
                    const host = (sel?.anchorNode instanceof Element
                      ? sel.anchorNode
                      : sel?.anchorNode?.parentElement
                    )?.closest('[data-testid^="block-editable-"]') as HTMLElement | null;
                    const blockId = host
                      ?.getAttribute("data-testid")
                      ?.replace("block-editable-", "");
                    if (blockId) editor.turnInto(blockId, opt.type);
                    setTurnOpen(false);
                  }}
                  className="block w-full px-3 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  {t(TURN_INTO_KO[opt.type] ?? opt.label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
        <ToolButton testid="format-bold" label={t("굵게 (Ctrl+B)")} onClick={() => exec("bold")}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton testid="format-italic" label={t("기울임꼴 (Ctrl+I)")} onClick={() => exec("italic")}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton testid="format-underline" label={t("밑줄 (Ctrl+U)")} onClick={() => exec("underline")}>
          <Underline size={14} />
        </ToolButton>
        <ToolButton testid="format-strike" label={t("취소선")} onClick={() => exec("strikeThrough")}>
          <Strikethrough size={14} />
        </ToolButton>
        <ToolButton testid="format-code" label={t("코드 (Ctrl+E)")} onClick={() => exec("code")}>
          <Code size={14} />
        </ToolButton>
        <ToolButton
          testid="format-link"
          label={t("링크 (Ctrl+K)")}
          onClick={() => {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
              savedRangeRef.current = sel.getRangeAt(0).cloneRange();
            }
            setLinkOpen((v) => !v);
            setTimeout(() => linkRef.current?.focus(), 0);
          }}
        >
          <LinkIcon size={14} />
        </ToolButton>
        <ToolButton
          testid="format-unlink"
          label={t("링크 제거")}
          onClick={() => {
            const sel = window.getSelection();
            const host = sel?.anchorNode
              ? (sel.anchorNode instanceof Element
                  ? sel.anchorNode
                  : sel.anchorNode.parentElement
                )?.closest('[data-testid^="block-editable-"]')
              : null;
            exec("unlink");
            (host as HTMLElement | null)?.dispatchEvent(
              new Event("input", { bubbles: true })
            );
          }}
        >
          <Unlink size={14} />
        </ToolButton>
        <ToolButton
          testid="format-color"
          label={t("텍스트 및 배경 색상")}
          onClick={() => setColorOpen((v) => !v)}
        >
          <Palette size={14} />
        </ToolButton>
        <ToolButton
          testid="format-comment"
          label={t("댓글")}
          onClick={() => {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
              savedRangeRef.current = sel.getRangeAt(0).cloneRange();
            }
            setCommentOpen((v) => !v);
            setTimeout(() => commentRef.current?.focus(), 0);
          }}
        >
          <MessageSquarePlus size={14} />
        </ToolButton>
      </div>
      {colorOpen && (
        <div className="border-t border-neutral-100 p-1.5 dark:border-neutral-700">
          <div className="mb-1 flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                data-testid={`format-color-${c}`}
                onClick={() => {
                  wrapColor(`c-${c}`);
                  setColorOpen(false);
                }}
                aria-label={t("{color} 텍스트", { color: t(COLOR_KO[c] ?? c) })}
                className={`flex h-5 w-5 items-center justify-center rounded text-xs font-semibold c-${c} hover:bg-neutral-100 dark:hover:bg-neutral-700`}
              >
                A
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                data-testid={`format-bg-${c}`}
                onClick={() => {
                  wrapColor(`hl-${c}`);
                  setColorOpen(false);
                }}
                aria-label={t("{color} 배경", { color: t(COLOR_KO[c] ?? c) })}
                className={`h-5 w-5 rounded border border-neutral-200 hl-${c} dark:border-neutral-600`}
              />
            ))}
          </div>
        </div>
      )}
      {linkOpen && (
        <div className="border-t border-neutral-100 p-1.5 dark:border-neutral-700">
          <input
            ref={linkRef}
            data-testid="format-link-input"
            placeholder={t("링크를 붙여넣고 Enter를 누르세요")}
            onKeyDown={(e) => {
              if (!isImeComposing(e) && e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) applyLink(v);
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            className="w-56 rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
      )}
      {commentOpen && (
        <div className="flex gap-1 border-t border-neutral-100 p-1.5 dark:border-neutral-700">
          <input
            ref={commentRef}
            data-testid="comment-range-input"
            placeholder={t("선택 영역에 댓글 달기…")}
            onKeyDown={(e) => {
              if (!isImeComposing(e) && e.key === "Enter") submitRangeComment((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setCommentOpen(false);
            }}
            className="w-56 rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
          />
          <button
            data-testid="comment-range-submit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => submitRangeComment(commentRef.current?.value ?? "")}
            className="shrink-0 rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600"
          >
            {t("보내기")}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  testid,
  label,
  onClick,
  children,
}: {
  testid: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-testid={testid}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
    >
      {children}
    </button>
  );
}
