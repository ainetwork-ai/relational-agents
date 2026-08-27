"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AtSign, ArrowUp, Paperclip } from "lucide-react";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useCommentsStore } from "@/stores/comments";
import { useT } from "@/i18n/provider";
import { useIntlLocale } from "@/i18n/provider";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/stores/me";

/**
 * What the original opens when you press a row's comment badge: a 480px card
 * hanging under the title cell with that page's comments in one flat column,
 * and a composer along the bottom.
 * (e2e/fixtures/notion-row-comments.json — popover / comment / composer)
 *
 * Not the side panel we had. The panel is a different surface with a header,
 * bordered thread cards and 해결 buttons; the original shows none of that
 * here — just avatar, name, date, body, repeated.
 */
export function RowCommentPopover({
  pageId,
  anchorRef,
  onClose,
}: {
  pageId: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const me = useMe();
  const panel = useRef<HTMLDivElement>(null);
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);
  const add = useCommentsStore((s) => s.add);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

  // the original centres the card on the badge, not on the cell: badge centre
 // 901 / card centre 901.25 (e2e/fixtures/notion-row-comments.json)
  useAnchored(true, anchorRef, panel, { gap: 4, align: "center" });
  useDismiss(true, onClose, anchorRef, panel);

 // one flat column, oldest first — the original does not nest replies here
  const comments = [...(list ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await add(pageId, body, null);
  }

  return createPortal(
    <div
      ref={panel}
      data-testid="row-comment-popover"
      style={{
        visibility: "hidden",
        width: 480,
        boxShadow:
          "rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px",
      }}
      className="popover-anim fixed z-[70] flex flex-col overflow-hidden rounded-[10px] bg-white dark:bg-neutral-900"
    >
      {/* 14px in from the card's top and left edge — the avatars line up on 14,
          the text column on 46 */}
      <div className="max-h-[420px] overflow-y-auto pt-[14px]">
        {comments.length === 0 && (
          <p className="px-[14px] pb-3 text-[14px] text-neutral-400">{t("아직 댓글이 없습니다.")}</p>
        )}
        {comments.map((c) => (
          <div key={c.id} data-testid={`row-comment-${c.id}`} className="flex px-[14px] pb-1">
            <UserAvatar user={c.author ?? { displayName: t("누군가") }} size={24} />
            {/* the name line is as tall as the avatar (24) and the body starts
                12px under it — in the original a comment's body top sits 36px
                below its avatar top */}
            <div className="ml-2 min-w-0 flex-1">
              <div className="flex h-6 items-center">
                <span className="text-[14px] font-medium leading-[21px] text-[#2c2c2b] dark:text-neutral-200">
                  {c.author?.displayName ?? t("누군가")}
                </span>
                <span className="ml-1.5 text-[12px] font-normal leading-[14px] text-[rgb(161,158,153)]">
                  {fmtCommentDate(c.createdAt, locale)}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[14px] font-normal leading-[24px] text-[#2c2c2b] dark:text-neutral-200">
                {c.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* composer — 8px above, 16px each side, flush to the card's bottom */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-2">
        <UserAvatar user={me ?? { displayName: "" }} size={24} />
        <input
          data-testid="row-comment-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t("댓글 추가")}
          className="min-w-0 flex-1 bg-transparent text-[14px] leading-[24px] text-[#2c2c2b] outline-none placeholder:text-[rgb(161,158,153)] dark:text-neutral-200"
        />
        <button
          type="button"
          aria-label={t("첨부")}
          className="shrink-0 rounded p-1 text-[rgb(142,139,134)] hover:bg-[rgba(33,27,23,0.051)]"
        >
          <Paperclip size={16} />
        </button>
        <button
          type="button"
          aria-label={t("멘션")}
          className="shrink-0 rounded p-1 text-[rgb(142,139,134)] hover:bg-[rgba(33,27,23,0.051)]"
        >
          <AtSign size={16} />
        </button>
        <button
          type="button"
          data-testid="row-comment-submit"
          onClick={() => void submit()}
          aria-label={t("댓글 보내기")}
          disabled={!draft.trim()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(35,131,226)] text-white transition-opacity disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-neutral-700"
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>,
    document.body
  );
}

/** The original prints a comment's date as 5월 14일 — month/day, no year. */
function fmtCommentDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(d);
}
