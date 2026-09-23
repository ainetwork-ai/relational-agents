"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, X, Check, CornerDownRight } from "lucide-react";
import { useCommentsStore, type PageComment } from "@/stores/comments";
import { CommentActions, CommentBody } from "./comment-thread";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { useT } from "@/i18n/provider";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { MentionInput, type MentionInputHandle } from "./mention-input";

/** R016–R018 — comments. A thread opens in a side panel anchored
 * to its block (or the page-level discussion), shows the root + threaded
 * replies, and can be resolved (which clears the block highlight). Replaces
 * the old flat bottom "Comments" list. */
export function CommentThreadPanel({ pageId }: { pageId: string }) {
  const t = useT();
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);
  const openAnchor = useCommentUi((s) => s.openAnchor);
  const close = useCommentUi((s) => s.close);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

 // A DATABASE ROW's page keeps its comments in the page (page-comment-section)
 // and never opens this. An ordinary page has no such section in the original
 // either — where its comments go is not measured — so the panel stays its
 // surface, along with every block-anchored thread.
  if (openAnchor === null) return null;

  const comments = list ?? [];
  const isPage = openAnchor === PAGE_ANCHOR;
 // thread roots for the open anchor (page discussion vs a specific block).
 // A reply whose parent is gone counts as a root: deleting a head keeps its
 // replies (Notion, measured 2026-09-10) and they must not become invisible
 // while still counting towards the badge.
  const alive = new Set(comments.map((c) => c.id));
  const isRoot = (c: PageComment) => c.parentId === null || !alive.has(c.parentId);
  const roots = comments.filter(
    (c) => isRoot(c) && (isPage ? c.blockId === null : c.blockId === openAnchor)
  );
  const repliesOf = (id: string) =>
    comments
      .filter((c) => c.parentId === id && alive.has(id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
 // z above a peek (z-50) rather than behind it: 댓글 opens from inside one
    <aside
      data-testid="comment-thread-panel"
      className="popover-anim fixed right-0 top-0 z-[60] flex h-full w-[340px] flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
        <MessageSquare size={16} />
        {isPage ? t("댓글") : t("블록 댓글")}
        <button
          data-testid="comment-thread-close"
          onClick={close}
          aria-label={t("댓글 닫기")}
          className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
        >
          <X size={15} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {roots.length === 0 && (
          <p className="text-sm text-neutral-400">{t("아직 댓글이 없습니다.")}</p>
        )}
        {roots.map((root) => (
          <ThreadCard
            key={root.id}
            pageId={pageId}
            root={root}
            replies={repliesOf(root.id)}
          />
        ))}
      </div>

      <NewComment pageId={pageId} anchor={openAnchor} />
    </aside>
  );
}

/** A single thread: the root comment + its replies + a reply composer. */
function ThreadCard({
  pageId,
  root,
  replies,
}: {
  pageId: string;
  root: PageComment;
  replies: PageComment[];
}) {
  const t = useT();
  const setResolved = useCommentsStore((s) => s.setResolved);
  const reply = useCommentsStore((s) => s.reply);
  const [draft, setDraft] = useState("");
  const mention = useRef<MentionInputHandle>(null);

  async function submitReply() {
    const body = draft.trim();
    if (!body) return;
    const mentionIds = mention.current?.mentionIds(body) ?? [];
    setDraft("");
    mention.current?.clear();
    await reply(pageId, root.id, body, mentionIds);
  }

  return (
    <div
      data-testid={`comment-thread-card-${root.id}`}
      className={`rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700 ${
        root.resolved ? "opacity-60" : ""
      }`}
    >
      <CommentBubble comment={root} pageId={pageId} />

      {/* resolve / reopen the whole thread */}
      <div className="mt-1 flex justify-end">
        {root.resolved ? (
          <button
            data-testid={`comment-reopen-${root.id}`}
            onClick={() => setResolved(pageId, root.id, false)}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            {t("다시 열기")}
          </button>
        ) : (
          <button
            data-testid={`comment-resolve-${root.id}`}
            onClick={() => setResolved(pageId, root.id, true)}
            className="flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-700"
          >
            <Check size={12} /> {t("해결")}
          </button>
        )}
      </div>

      {/* threaded replies */}
      {replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-neutral-100 pl-2 dark:border-neutral-800">
          {replies.map((r) => (
            <CommentBubble key={r.id} comment={r} reply pageId={pageId} />
          ))}
        </div>
      )}

      {/* reply composer */}
      <div className="mt-2 flex items-center gap-1">
        <CornerDownRight size={13} className="shrink-0 text-neutral-300" />
        {/* the same @ menu as the page composer — all three comment surfaces
            behave alike */}
        <MentionInput
          ref={mention}
          inputTestId={`comment-reply-input-${root.id}`}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submitReply()}
          placeholder={t("답글…")}
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-400 dark:border-neutral-600 dark:text-neutral-200"
        />
        <button
          data-testid={`comment-reply-submit-${root.id}`}
          onClick={() => void submitReply()}
          className="rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600"
        >
          {t("답글")}
        </button>
      </div>
    </div>
  );
}

function CommentBubble({
  comment,
  reply,
  pageId,
}: {
  comment: PageComment;
  reply?: boolean;
  pageId: string;
}) {
  const t = useT();
  const members = useWorkspaceMembers();
  return (
    <div data-testid={`comment-item-${comment.id}`} className="group/comment relative">
      {/* the same author-only ⋯ → 삭제하기 as the in-page rows. This panel is
          also rendered on public /share links, where there is no signed-in
          user — CommentActions draws nothing without one. */}
      <CommentActions comment={comment} pageId={pageId} />
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {comment.author?.displayName ?? t("누군가")}
        </span>
        {comment.resolved && !reply && (
          <span className="text-[11px] uppercase tracking-wide text-green-600">
            {t("해결됨")}
          </span>
        )}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
        <CommentBody body={comment.body} members={members} />
      </p>
    </div>
  );
}

/** Compose a new root comment on the current anchor (page or a block). */
function NewComment({ pageId, anchor }: { pageId: string; anchor: string }) {
  const t = useT();
  const add = useCommentsStore((s) => s.add);
  const [draft, setDraft] = useState("");
  const mention = useRef<MentionInputHandle>(null);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    const mentionIds = mention.current?.mentionIds(body) ?? [];
    setDraft("");
    mention.current?.clear();
    await add(pageId, body, anchor === PAGE_ANCHOR ? null : anchor, [], mentionIds);
  }

  return (
    <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <MentionInput
        ref={mention}
        inputTestId="comment-input"
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submit()}
        placeholder={t("댓글 추가…")}
        className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-400 dark:border-neutral-600 dark:text-neutral-200"
      />
      <button
        data-testid="comment-submit"
        onClick={() => void submit()}
        className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
      >
        {t("댓글")}
      </button>
    </div>
  );
}
