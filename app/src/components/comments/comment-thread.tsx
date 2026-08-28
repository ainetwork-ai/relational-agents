"use client";

import { useState, type ReactNode } from "react";
import { AtSign, ArrowUp, Paperclip } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/stores/me";
import { useCommentsStore, type PageComment } from "@/stores/comments";
import { useT, useIntlLocale } from "@/i18n/provider";
import { useImeGuard } from "@/hooks/use-ime-guard";

/**
 * One comment, and the row of them — the shape the original uses in BOTH
 * places it shows comments (the table's popover and the page's own 댓글
 * section). Measured in both and identical:
 *
 *   [24 avatar]  Name(14/500)  5월 14일(12/400, rgb(161,158,153))   ← 24px line
 *                body (14, rgb(44,44,43))                          ← starts at avatar top + 24
 *                                                                  ← 16 to the next comment
 *
 * (e2e/fixtures/notion-row-comments.json — comment / inline / mention)
 */
export function CommentRow({ comment }: { comment: PageComment }) {
  const t = useT();
  const locale = useIntlLocale();
  return (
    <div data-testid={`comment-row-${comment.id}`} className="flex pb-4">
      <UserAvatar user={comment.author ?? { displayName: t("누군가") }} size={24} />
      <div className="ml-2 min-w-0 flex-1">
        {/* the name line is as tall as the avatar; the body sits straight under it */}
        <div className="flex h-6 items-center">
          <span className="text-[14px] font-medium leading-[21px] text-[#2c2c2b] dark:text-neutral-200">
            {comment.author?.displayName ?? t("누군가")}
          </span>
          <span className="ml-1.5 text-[12px] font-normal leading-4 text-[rgb(161,158,153)]">
            {fmtCommentDate(comment.createdAt, locale)}
          </span>
        </div>
 {/* 2px above and below: the original's body element measures 24 on a
            20px line, which is what makes one comment 64 tall */}
        <p className="whitespace-pre-wrap py-[2px] text-[14px] font-normal leading-5 text-[#2c2c2b] dark:text-neutral-200">
          <CommentBody body={comment.body} />
        </p>
      </div>
    </div>
  );
}

/**
 * A mention inside a comment. The original does NOT draw a chip: no
 * background, no radius, no padding, no avatar — just the name tinted
 * rgb(125,122,117), with the @ itself dimmer still.
 */
export function CommentBody({ body }: { body: string }): ReactNode {
  const parts = body.split(MENTION);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-[rgb(125,122,117)]">
        <span className="text-[rgba(125,122,117,0.6)]">@</span>
        {part}
      </span>
    ) : (
      part
    )
  );
}

/** `@` + a name that may hold single spaces — the shape our composer writes. */
const MENTION = /@([\p{L}\p{N}_]+(?: [\p{L}\p{N}_]+)?)/gu;

/**
 * The line that adds one. The original keeps three 24×24 buttons (radius 6) on
 * the right at a 30px pitch: 파일 첨부 · 멘션 · 댓글 보내기.
 */
export function CommentComposer({
  pageId,
  blockId = null,
  autoFocus,
}: {
  pageId: string;
  blockId?: string | null;
  autoFocus?: boolean;
}) {
  const t = useT();
  const me = useMe();
  const add = useCommentsStore((s) => s.add);
  const [draft, setDraft] = useState("");
  const ime = useImeGuard();

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await add(pageId, body, blockId);
  }

  return (
    <div className="flex items-center">
      <UserAvatar user={me ?? { displayName: "" }} size={24} />
      <input
        data-testid="comment-composer-input"
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        {...ime.imeProps}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
         // Enter that is settling a Korean syllable is not a send — without
         // this the same keypress posted the text and then its last letter
          if (ime.composing(e)) return;
          e.preventDefault();
          void submit();
        }}
        placeholder={t("댓글 추가")}
       // 2.5px of its own padding, so the BOX starts at 29.5 and the text at
       // 32 — level with a comment's text column
        className="ml-[5.5px] min-w-0 flex-1 bg-transparent p-[2.5px] text-[14px] leading-5 text-[#2c2c2b] outline-none placeholder:text-[rgb(161,158,153)] dark:text-neutral-200"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <ComposerButton label={t("파일 첨부")}>
          <Paperclip size={16} />
        </ComposerButton>
        <ComposerButton label={t("멘션하려는 사용자, 페이지, 날짜를 입력하세요.")}>
          <AtSign size={16} />
        </ComposerButton>
        <ComposerButton
          label={t("댓글 보내기")}
          testid="comment-composer-submit"
          onClick={() => void submit()}
          disabled={!draft.trim()}
        >
          <ArrowUp size={16} />
        </ComposerButton>
      </div>
    </div>
  );
}

function ComposerButton({
  label,
  children,
  onClick,
  disabled,
  testid,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[rgb(142,139,134)] hover:bg-[rgba(33,27,23,0.051)] disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}

/**
 * Put the caret in the page's 댓글 composer, and say whether there was one.
 * A database row's page has the section in the page, so its header button
 * goes there; an ordinary page has no such section in the original, so its
 * button falls back to the panel.
 *
 * `inline: "nearest"` on purpose — a plain scrollIntoView() also scrolls
 * sideways, which drags a wide table out from under the reader
 * (docs/notion-projects-spec.md, "재보다 틀렸던 것들").
 */
export function focusPageComposer(): boolean {
  const el = document.querySelector<HTMLInputElement>('[data-testid="comment-composer-input"]');
  if (!el) return false;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  el.focus();
  return true;
}

/** The original prints a comment's date as 5월 14일 — month/day, no year. */
export function fmtCommentDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(d);
}
