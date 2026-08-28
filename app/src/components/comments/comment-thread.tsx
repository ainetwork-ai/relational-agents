"use client";

import { useState, type ReactNode } from "react";
import { AtSign, ArrowUp, Paperclip } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/stores/me";
import { useCommentsStore, type PageComment } from "@/stores/comments";
import { useT, useIntlLocale } from "@/i18n/provider";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { useComposerAttachments, AttachmentsList } from "@/components/chat/composer-attachments";

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
export function CommentRow({
  comment,
 // 8 instead of 16 underneath, for the row that sits right above the
 // "답글 N개 더 보기" line (the original keeps 8 on each side of it)
  tightBottom,
}: {
  comment: PageComment;
  tightBottom?: boolean;
}) {
  const t = useT();
  const locale = useIntlLocale();
  return (
    <div
      data-testid={`comment-row-${comment.id}`}
      className={`flex ${tightBottom ? "pb-2" : "pb-4"}`}
    >
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
        {comment.body && (
          <p className="whitespace-pre-wrap py-[2px] text-[14px] font-normal leading-5 text-[#2c2c2b] dark:text-neutral-200">
            <CommentBody body={comment.body} />
          </p>
        )}
        <CommentAttachments attachments={comment.attachments} />
      </div>
    </div>
  );
}

/**
 * The files on a comment, drawn the way the original draws them
 * (e2e/fixtures/notion-row-comments.json — clip.attachmentRendering).
 *
 * An image goes into a 240×240 box, `object-fit: contain`, radius 8 — so a
 * tall shot lands at 180×240 rather than running down the page, and a wide
 * banner at 240×86.
 *
 * Anything else is two lines and nothing else: the name at 14/500/18 and the
 * size under it at 12/400/15 in rgb(125,122,117). No icon, no border, no
 * background — the original has none of those here.
 */
export function CommentAttachments({
  attachments,
}: {
  attachments?: {
    id: string;
    name: string;
    size?: number;
    mimeType?: string;
    width?: number;
    height?: number;
  }[];
}) {
  if (!attachments?.length) return null;
  return (
    <div className="flex flex-col items-start gap-2 py-[2px]">
      {attachments.map((a) =>
        IMAGE.test(a.name) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={a.id}
            src={`/api/files/${a.id}/stream`}
            alt={a.name}
            data-testid="comment-attachment-image"
            className="max-h-[240px] max-w-[240px] rounded-[8px] object-contain"
          />
        ) : (
          <a
            key={a.id}
            href={`/api/files/${a.id}/download`}
            target="_blank"
            rel="noreferrer"
            data-testid="comment-attachment-file"
            className="block max-w-full"
          >
            <span
              data-testid="comment-attachment-name"
              className="block truncate text-[14px] font-medium leading-[18px] text-[#2c2c2b] hover:underline dark:text-neutral-200"
            >
              {a.name}
            </span>
            {a.size !== undefined && (
              <span
                data-testid="comment-attachment-size"
                className="block text-[12px] font-normal leading-[15px] text-[rgb(125,122,117)]"
              >
                {fmtBytes(a.size)}
              </span>
            )}
          </a>
        )
      )}
    </div>
  );
}

/** Which attachments get drawn rather than listed. The authority is the
 *  stream route's own media gate — this only decides which element to render;
 *  a mistake here is a broken <img>, not an executed script. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** The original writes binary units to one decimal: 12.7 KiB · 65.8 MiB. */
export function fmtBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
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
 // the clip: same upload path the chat composer uses (/api/upload → chips)
  const attach = useComposerAttachments();

  async function submit() {
    const body = draft.trim();
 // files alone are a comment — the original lets you send with nothing typed
    if (!body && !attach.attachments.length) return;
    const files = attach.attachments.map((a) => ({
      url: a.url,
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
    }));
    setDraft("");
    attach.clear();
    await add(pageId, body, blockId, files);
  }

  return (
    <div>
      <AttachmentsList
        attachments={attach.attachments}
        error={attach.error}
        onRemove={attach.removeAttachment}
      />
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
        {/* the original's clip opens the OS picker straight away — no menu,
            many files at once, no type restriction (measured: fileChooser
            mode selectMultiple, accept null) */}
        <ComposerButton label={t("파일 첨부")} onClick={attach.openFilePicker}>
          <Paperclip size={16} />
        </ComposerButton>
        <input
          ref={attach.fileInputRef}
          type="file"
          multiple
          data-testid="comment-file-input"
          onChange={attach.handleFileInputChange}
          className="hidden"
        />
        <ComposerButton label={t("멘션하려는 사용자, 페이지, 날짜를 입력하세요.")}>
          <AtSign size={16} />
        </ComposerButton>
        <ComposerButton
          label={t("댓글 보내기")}
          testid="comment-composer-submit"
          onClick={() => void submit()}
          disabled={!draft.trim() && !attach.attachments.length}
        >
          <ArrowUp size={16} />
        </ComposerButton>
      </div>
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
 * A thread longer than three collapses to its first and last comment, with the
 * rest behind one line. Counted in the original across eight pages
 * (e2e/fixtures/notion-row-comments.json — collapse):
 *
 *   1·2·3 comments → all of them, no line
 *   4 → 2 shown, 답글 2개 더 보기      8 → 2 shown, 답글 6개 더 보기
 *   5 → 2 shown, 답글 3개 더 보기      9 → 2 shown, 답글 7개 더 보기
 *                                     11 → 2 shown, 답글 9개 더 보기
 *
 * Always the first and the last, and the number on the line is always
 * total − 2. Pressing it opens the thread and does not fold back — the
 * original's line is gone once expanded.
 */
export const COLLAPSE_ABOVE = 3;

export function CommentList({ comments }: { comments: PageComment[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (comments.length <= COLLAPSE_ABOVE || expanded)
    return (
      <>
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} />
        ))}
      </>
    );

  const hidden = comments.length - 2;
  return (
    <>
      <CommentRow comment={comments[0]} tightBottom />
      <button
        type="button"
        data-testid="comment-show-more"
        onClick={() => setExpanded(true)}
        className="mb-2 ml-6 flex h-7 items-center rounded-[6px] text-[14px] font-normal leading-[16.8px] text-[rgb(125,122,117)] hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-white/10"
      >
        {t("답글 {n}개 더 보기", { n: hidden })}
      </button>
      <CommentRow comment={comments[comments.length - 1]} />
    </>
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
