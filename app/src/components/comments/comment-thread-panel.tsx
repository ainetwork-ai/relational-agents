"use client";

import { useEffect, useState } from "react";
import { MessageSquare, X, Check, CornerDownRight } from "lucide-react";
import { useCommentsStore, type PageComment } from "@/stores/comments";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";

/** R016–R018 — Notion-style comments. A thread opens in a side panel anchored
 *  to its block (or the page-level discussion), shows the root + threaded
 *  replies, and can be resolved (which clears the block highlight). Replaces
 *  the old flat bottom "Comments" list. */
export function CommentThreadPanel({ pageId }: { pageId: string }) {
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);
  const openAnchor = useCommentUi((s) => s.openAnchor);
  const close = useCommentUi((s) => s.close);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

  if (openAnchor === null) return null;

  const comments = list ?? [];
  const isPage = openAnchor === PAGE_ANCHOR;
  // thread roots for the open anchor (page discussion vs a specific block)
  const roots = comments.filter(
    (c) =>
      c.parentId === null &&
      (isPage ? c.blockId === null : c.blockId === openAnchor)
  );
  const repliesOf = (id: string) =>
    comments
      .filter((c) => c.parentId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <aside
      data-testid="comment-thread-panel"
      className="popover-anim fixed right-0 top-0 z-40 flex h-full w-[340px] flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
        <MessageSquare size={16} />
        {isPage ? "Comments" : "Comment on block"}
        <button
          data-testid="comment-thread-close"
          onClick={close}
          aria-label="Close comments"
          className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
        >
          <X size={15} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {roots.length === 0 && (
          <p className="text-sm text-neutral-400">No comments yet.</p>
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
  const setResolved = useCommentsStore((s) => s.setResolved);
  const reply = useCommentsStore((s) => s.reply);
  const [draft, setDraft] = useState("");

  async function submitReply() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await reply(pageId, root.id, body);
  }

  return (
    <div
      data-testid={`comment-thread-card-${root.id}`}
      className={`rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-700 ${
        root.resolved ? "opacity-60" : ""
      }`}
    >
      <CommentBubble comment={root} />

      {/* resolve / reopen the whole thread */}
      <div className="mt-1 flex justify-end">
        {root.resolved ? (
          <button
            data-testid={`comment-reopen-${root.id}`}
            onClick={() => setResolved(pageId, root.id, false)}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            Re-open
          </button>
        ) : (
          <button
            data-testid={`comment-resolve-${root.id}`}
            onClick={() => setResolved(pageId, root.id, true)}
            className="flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-700"
          >
            <Check size={12} /> Resolve
          </button>
        )}
      </div>

      {/* threaded replies */}
      {replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-neutral-100 pl-2 dark:border-neutral-800">
          {replies.map((r) => (
            <CommentBubble key={r.id} comment={r} reply />
          ))}
        </div>
      )}

      {/* reply composer (Notion: reply within the thread) */}
      <div className="mt-2 flex items-center gap-1">
        <CornerDownRight size={13} className="shrink-0 text-neutral-300" />
        <input
          data-testid={`comment-reply-input-${root.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitReply();
            }
          }}
          placeholder="Reply…"
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-400 dark:border-neutral-600 dark:text-neutral-200"
        />
        <button
          data-testid={`comment-reply-submit-${root.id}`}
          onClick={() => void submitReply()}
          className="rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600"
        >
          Reply
        </button>
      </div>
    </div>
  );
}

function CommentBubble({
  comment,
  reply,
}: {
  comment: PageComment;
  reply?: boolean;
}) {
  return (
    <div data-testid={`comment-item-${comment.id}`} className={reply ? "" : ""}>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {comment.author?.displayName ?? "Someone"}
        </span>
        {comment.resolved && !reply && (
          <span className="text-[11px] uppercase tracking-wide text-green-600">
            Resolved
          </span>
        )}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
        {comment.body}
      </p>
    </div>
  );
}

/** Compose a new root comment on the current anchor (page or a block). */
function NewComment({ pageId, anchor }: { pageId: string; anchor: string }) {
  const add = useCommentsStore((s) => s.add);
  const [draft, setDraft] = useState("");

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await add(pageId, body, anchor === PAGE_ANCHOR ? null : anchor);
  }

  return (
    <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <input
        data-testid="comment-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Add a comment…"
        className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-400 dark:border-neutral-600 dark:text-neutral-200"
      />
      <button
        data-testid="comment-submit"
        onClick={() => void submit()}
        className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
      >
        Comment
      </button>
    </div>
  );
}
