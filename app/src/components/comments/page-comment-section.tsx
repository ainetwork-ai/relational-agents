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
export function PageCommentSection({ pageId }: { pageId: string }) {
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

 // page-level only: a comment tied to a block belongs beside that block
  const comments = [...(list ?? [])]
    .filter((c) => c.blockId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div data-testid="page-comment-section">
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} />
      ))}
      <CommentComposer pageId={pageId} />
    </div>
  );
}
