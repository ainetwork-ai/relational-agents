"use client";

import { useEffect } from "react";
import { useCommentsStore } from "@/stores/comments";
import { CommentRow, CommentComposer } from "./comment-thread";

/**
 * A page's comments where the original keeps them: **in the page**, between the
 * property band and the body — not in a panel docked to the window.
 * (e2e/fixtures/notion-row-comments.json — inline)
 *
 * The container has `overflow-y: visible` and no max-height in the original:
 * a long thread makes the section taller and the page scrolls. So there is no
 * cap here on purpose — a scrollbar inside the page body would be ours, not
 * Notion's.
 *
 * Block-anchored comments are a different thing and still open in the panel.
 */
export function PageCommentSection({
  pageId,
 // the original renders no composer on a row page that has no comments yet —
 // the 댓글 label is there, the input is not, until you press it
  composerRequested = false,
}: {
  pageId: string;
  composerRequested?: boolean;
}) {
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

 // page-level only: a comment tied to a block belongs beside that block
  const comments = [...(list ?? [])]
    .filter((c) => c.blockId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

 // the container is there either way in the original (empty when the page has
 // no comments yet) — only the composer waits to be asked for
  const showComposer = comments.length > 0 || composerRequested;

  return (
    <div data-testid="page-comment-section">
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} />
      ))}
      {showComposer && <CommentComposer pageId={pageId} autoFocus={composerRequested} />}
    </div>
  );
}
