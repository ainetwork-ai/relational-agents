"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AtSign, ArrowUp, MoreHorizontal, Paperclip } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { useMe } from "@/stores/me";
import { useCommentsStore, type PageComment } from "@/stores/comments";
import { useT, useIntlLocale } from "@/i18n/provider";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useComposerAttachments, AttachmentsList } from "@/components/chat/composer-attachments";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { MentionInput, type MentionInputHandle } from "./mention-input";
import type { MentionPerson } from "@/lib/mention/search";

/**
 * One comment, and the row of them — the shape the original uses in BOTH
 * places it shows comments (the table's popover and the page's own Comments
 * section). Measured in both and identical:
 *
 *   [24 avatar]  Name(14/500)  May 14(12/400, rgb(161,158,153))   ← 24px line
 *                body (14, rgb(44,44,43))                          ← starts at avatar top + 24
 *                                                                  ← 16 to the next comment
 *
 * (e2e/fixtures/notion-row-comments.json — comment / inline / mention)
 */
export function CommentRow({
  comment,
 // 8 instead of 16 underneath, for the row that sits right above the
 // "Show N more replies" line (the original keeps 8 on each side of it)
  tightBottom,
  pageId,
}: {
  comment: PageComment;
  tightBottom?: boolean;
 // needed only to delete; the surfaces that pass it get the ⋯ affordance
  pageId?: string;
}) {
  const t = useT();
  const locale = useIntlLocale();
 // only a real member's name is a mention (see CommentBody). The pageId names
 // the workspace to ask about — this page's, not the session's active one.
  const members = useWorkspaceMembers(false, pageId);
  return (
    <div
      data-testid={`comment-row-${comment.id}`}
      className={`group/comment relative flex ${tightBottom ? "pb-2" : "pb-4"}`}
    >
      <UserAvatar user={comment.author ?? { displayName: t("Someone") }} size={24} />
      <div className="ml-2 min-w-0 flex-1">
        {/* the name line is as tall as the avatar; the body sits straight under it */}
        <div className="flex h-6 items-center">
          <span className="text-[14px] font-medium leading-[21px] text-[#2c2c2b] dark:text-neutral-200">
            {comment.author?.displayName ?? t("Someone")}
          </span>
          <span className="ml-1.5 text-[12px] font-normal leading-4 text-[rgb(161,158,153)]">
            {fmtCommentDate(comment.createdAt, locale)}
          </span>
        </div>
 {/* 2px above and below: the original's body element measures 24 on a
            20px line, which is what makes one comment 64 tall */}
        {comment.body && (
          <p className="whitespace-pre-wrap py-[2px] text-[14px] font-normal leading-5 text-[#2c2c2b] dark:text-neutral-200">
            <CommentBody body={comment.body} members={members} />
          </p>
        )}
        <CommentAttachments attachments={comment.attachments} />
      </div>
      {/* LAST child, absolutely positioned, and free of <span> and borders on
          purpose: three golden checks read this row's avatar as its first
          child, the author and date as its first two spans, and its pitch and
          insets to the pixel — an inline control would move all of them
          (docs/notion-comment-delete.md §4). */}
      {pageId && <CommentActions comment={comment} pageId={pageId} />}
    </div>
  );
}

/**
 * The Comment actions toolbar that appears on a comment when the pointer is over it,
 * and what its ⋯ opens. Measured on Notion 2026-09-10
 * (docs/notion-comment-delete.md):
 *
 *   toolbar   right-aligned, 28 tall, 24×24 buttons
 *   ⋯ menu    180 wide, radius 10, 28px rows, ink rgb(44,44,43) — NOT red
 *   items     your own comment adds Edit and Delete; someone else's gets
 *             neither, so the whole toolbar is drawn only for the author
 *   confirm   324×145 modal, radius 12, "Are you sure you want to delete this comment?",
 *             Delete in white on rgb(229,100,88) with Cancel under it
 *
 * Only Delete is implemented — Add reaction · Resolve · Edit · Copy link ·
 * Mark as unread are measured but not built.
 */
export function CommentActions({ comment, pageId }: { comment: PageComment; pageId: string }) {
  const t = useT();
  const me = useMe();
  const remove = useCommentsStore((s) => s.remove);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useAnchored(menuOpen, btn, menu, { gap: 4, align: "end" });
  useDismiss(menuOpen, () => setMenuOpen(false), btn, menu);

 // authorship is the gate, exactly as in the original — and it is also what
 // keeps the control off the public share surfaces, where there is no `me`
  if (!me || me.id !== comment.authorId) return null;

  return (
    <>
      <div
        aria-label={t("Comment actions")}
        data-testid={`comment-actions-${comment.id}`}
        className="pointer-events-none absolute right-0 top-0 flex h-7 items-center touch-reveal opacity-0 transition-opacity group-hover/comment:pointer-events-auto group-hover/comment:opacity-100"
      >
        <button
          ref={btn}
          type="button"
          aria-label={t("More actions")}
          title={t("More actions")}
          data-testid={`comment-more-${comment.id}`}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[rgb(142,139,134)] hover:bg-[rgba(33,27,23,0.051)] dark:bg-neutral-900 dark:hover:bg-white/10"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {menuOpen &&
        createPortal(
          <div
            ref={menu}
            // opened from inside the row comment card: a press here must not
            // close that card (useDismiss) — see use-dismiss.ts
            data-dismiss-layer=""
            data-testid={`comment-menu-${comment.id}`}
            style={{ visibility: "hidden", width: 180 }}
            className="popover-anim fixed z-[80] rounded-[10px] bg-white py-1 shadow-xl dark:bg-neutral-800"
          >
            <button
              type="button"
              data-testid={`comment-delete-${comment.id}`}
              onClick={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
              className="flex h-7 w-full items-center px-3 text-left text-[14px] leading-7 text-[#2c2c2b] hover:bg-[rgba(33,27,23,0.051)] dark:text-neutral-200 dark:hover:bg-white/10"
            >
              {t("Delete comment")}
            </button>
          </div>,
          document.body
        )}

      {confirming &&
        createPortal(
          <div
            data-dismiss-layer=""
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30"
            onMouseDown={() => setConfirming(false)}
          >
            <div
              data-testid={`comment-delete-confirm-${comment.id}`}
              style={{ width: 324 }}
              className="popover-anim rounded-[12px] bg-white p-4 shadow-xl dark:bg-neutral-800"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="px-1 pb-3 pt-1 text-[14px] leading-5 text-[#2c2c2b] dark:text-neutral-200">
                {t("Delete this comment?")}
              </p>
              {failed && (
                <p className="px-1 pb-2 text-[12px] leading-4 text-[rgb(229,100,88)]">
                  {t("Couldn't delete the comment")}
                </p>
              )}
              <button
                type="button"
                data-testid={`comment-delete-yes-${comment.id}`}
                onClick={async () => {
                  const ok = await remove(pageId, comment.id);
                  if (ok) setConfirming(false);
                  else setFailed(true);
                }}
                className="mb-1 flex h-8 w-full items-center justify-center rounded-[6px] bg-[rgb(229,100,88)] text-[14px] font-medium text-[rgb(253,246,246)] hover:brightness-95"
              >
                {t("Delete")}
              </button>
              <button
                type="button"
                data-testid={`comment-delete-no-${comment.id}`}
                onClick={() => setConfirming(false)}
                className="flex h-8 w-full items-center justify-center rounded-[6px] text-[14px] text-[#2c2c2b] hover:bg-[rgba(33,27,23,0.051)] dark:text-neutral-200 dark:hover:bg-white/10"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
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
 * rgb(125,122,117), with the @ itself dimmer still. Those two colours are
 * measured and already right (e2e/fixtures/notion-row-comments.json).
 *
 * What was wrong was WHICH text got them: any `@word` at all, so an email
 * address or a "@here" read as a mention. The original tints a real mention
 * token and nothing else, so a run counts only when it spells a workspace
 * member's display name. While the membership is still unknown (`null` — the
 * fetch is in flight, or this is a share link with no session) the body is
 * drawn as plain text: guessing is what we are fixing.
 */
export function CommentBody({
  body,
  members,
}: {
  body: string;
  members?: MentionPerson[] | null;
}): ReactNode {
  const re = mentionRe(members);
  if (!re) return body;
  const parts = body.split(re);
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

/**
 * `@` + the display name of an actual member — longest name first, so
 * "@Kim San" wins over a member also called "Kim", and never mid-word, so
 * "@Kim" does not light up inside "@Kimchi".
 */
function mentionRe(members?: MentionPerson[] | null): RegExp | null {
  if (!members?.length) return null;
  const names = members
    .map((m) => m.displayName)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return null;
  return new RegExp(`@(${names.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
}

/**
 * The line that adds one. The original keeps three 24×24 buttons (radius 6) on
 * the right at a 30px pitch: Attach file · Mention · Send comment.
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
 // the composer is the surface that is always here (a thread with no comments
 // yet still has one), so it is what tells the members fetch which page we are
 // on — the @ menu it opens is handed only a caret and a query
  useWorkspaceMembers(false, pageId);
  const [draft, setDraft] = useState("");
 // the clip: same upload path the chat composer uses (/api/upload → chips)
  const attach = useComposerAttachments();
  const mention = useRef<MentionInputHandle>(null);

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
 // only the people still spelled in the text: a mention the writer deleted
 // again must not send them a notification
    const mentionIds = mention.current?.mentionIds(body) ?? [];
    setDraft("");
    attach.clear();
    mention.current?.clear();
    await add(pageId, body, blockId, files, mentionIds);
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
      {/* MentionInput keeps the Enter rules (a menu-open Enter picks, an IME
          Enter settles a syllable, everything else sends) and adds the @ menu
          — the field itself is still the direct flex child the geometry
          checks measure. */}
      <MentionInput
        ref={mention}
        inputTestId="comment-composer-input"
        value={draft}
        autoFocus={autoFocus}
        onChange={setDraft}
        onSubmit={() => void submit()}
        placeholder={t("Add comment")}
       // 2.5px of its own padding, so the BOX starts at 29.5 and the text at
       // 32 — level with a comment's text column
        className="ml-[5.5px] min-w-0 flex-1 bg-transparent p-[2.5px] text-[14px] leading-5 text-[#2c2c2b] outline-none placeholder:text-[rgb(161,158,153)] dark:text-neutral-200"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        {/* the original's clip opens the OS picker straight away — no menu,
            many files at once, no type restriction (measured: fileChooser
            mode selectMultiple, accept null) */}
        <ComposerButton label={t("Attach file")} onClick={attach.openFilePicker}>
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
        {/* measured: the original's @ button really types an `@` into the
            line, and the menu opens off that character like any other */}
        <ComposerButton
          label={t("Mention a person, page, or date")}
          testid="comment-composer-mention"
          onClick={() => mention.current?.insertAt()}
        >
          <AtSign size={16} />
        </ComposerButton>
        <ComposerButton
          label={t("Send comment")}
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
 *   4 → 2 shown, Show 2 more replies    8 → 2 shown, Show 6 more replies
 *   5 → 2 shown, Show 3 more replies    9 → 2 shown, Show 7 more replies
 *                                     11 → 2 shown, Show 9 more replies
 *
 * Always the first and the last, and the number on the line is always
 * total − 2. Pressing it opens the thread and does not fold back — the
 * original's line is gone once expanded.
 */
export const COLLAPSE_ABOVE = 3;

export function CommentList({ comments, pageId }: { comments: PageComment[]; pageId?: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (comments.length <= COLLAPSE_ABOVE || expanded)
    return (
      <>
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} pageId={pageId} />
        ))}
      </>
    );

  const hidden = comments.length - 2;
  return (
    <>
      <CommentRow comment={comments[0]} tightBottom pageId={pageId} />
      <button
        type="button"
        data-testid="comment-show-more"
        onClick={() => setExpanded(true)}
        className="mb-2 ml-6 flex h-7 items-center rounded-[6px] text-[14px] font-normal leading-[16.8px] text-[rgb(125,122,117)] hover:bg-[rgba(33,27,23,0.051)] dark:hover:bg-white/10"
      >
        {t("Show {n} more replies", { n: hidden })}
      </button>
      <CommentRow comment={comments[comments.length - 1]} pageId={pageId} />
    </>
  );
}

/**
 * Put the caret in the page's Comments composer, and say whether there was one.
 * A database row's page has the section in the page, so its header button
 * goes there; an ordinary page has no such section in the original, so its
 * button falls back to the panel.
 *
 * `inline: "nearest"` on purpose — a plain scrollIntoView() also scrolls
 * sideways, which drags a wide table out from under the reader
 * (docs/notion-projects-spec.md, "Things we got wrong after measuring").
 */
export function focusPageComposer(): boolean {
  const el = document.querySelector<HTMLInputElement>('[data-testid="comment-composer-input"]');
  if (!el) return false;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  el.focus();
  return true;
}

/** The original prints a comment's date as "May 14" — month/day, no year. */
export function fmtCommentDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(d);
}
