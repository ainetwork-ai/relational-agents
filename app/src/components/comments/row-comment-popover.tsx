"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchored } from "@/hooks/use-anchored";
import { useDismiss } from "@/hooks/use-dismiss";
import { useCommentsStore } from "@/stores/comments";
import { useT } from "@/i18n/provider";
import { CommentRow, CommentComposer } from "./comment-thread";

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
  const panel = useRef<HTMLDivElement>(null);
  const list = useCommentsStore((s) => s.byPage[pageId]);
  const load = useCommentsStore((s) => s.load);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

 // the original centres the card on the badge, not on the cell: badge centre
 // 901 / card centre 901.25 (e2e/fixtures/notion-row-comments.json)
  useAnchored(true, anchorRef, panel, { gap: 4, align: "center" });
  useDismiss(true, onClose, anchorRef, panel);

 // one flat column, oldest first — the original does not nest replies here
  const comments = [...(list ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

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
          the text column on 46.
          The page's own 댓글 section has no cap and simply grows (the page
          scrolls); a card cannot, so this one scrolls inside itself. How the
          original caps a long thread HERE is not measured — the workspace has
          no row with more than four. */}
      <div className="max-h-[420px] overflow-y-auto px-[14px] pt-[14px]">
        {comments.length === 0 && (
          <p className="pb-3 text-[14px] text-neutral-400">{t("아직 댓글이 없습니다.")}</p>
        )}
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} />
        ))}
      </div>
      <div className="px-[14px] pb-3">
        <CommentComposer pageId={pageId} />
      </div>
    </div>,
    document.body
  );
}
