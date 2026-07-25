"use client";

import { useEffect, useRef, useState } from "react";
import type { Block, Page } from "@/lib/db/schema";
import { BlockEditor, type BlockEditorHandle } from "@/components/editor/block-editor";
import { ReadOnlyBlocks } from "@/components/read-only-blocks";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { MessageSquare } from "lucide-react";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { PageIcon } from "@/components/page-icon";

type Permission = "view" | "comment" | "edit" | "full";

/**
 * Shared page editor: renders the appropriate experience based on the
 * public link's permission level.
 *
 *   view    → ReadOnlyBlocks (static, no editing)
 *   comment → ReadOnlyBlocks + comment panel (can read comments)
 *   edit    → Full BlockEditor (can edit blocks)
 *   full    → Full BlockEditor (can edit blocks)
 *
 * For edit/full, the share token is injected into the global fetch so
 * the BlockEditor's API calls authenticate via x-share-token.
 */
export function SharedPageEditor({
  page,
  blocks,
  permission,
  shareToken,
}: {
  page: Page;
  blocks: Block[];
  permission: Permission;
  shareToken: string;
}) {
  const canEdit = permission === "edit" || permission === "full";
  const canComment = permission === "comment" || canEdit;
  const editorRef = useRef<BlockEditorHandle>(null);
  const [title, setTitle] = useState(page.title);
  const openComments = useCommentUi((s) => s.open);

  // Inject the share token into fetch for API calls from the editor.
  // We monkey-patch window.fetch to add x-share-token for same-origin
  // API requests. This is cleaned up on unmount.
  useEffect(() => {
    if (!canEdit && !canComment) return;

    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      // Only patch same-origin API calls
      if (url.startsWith("/api/")) {
        const headers = new Headers(init?.headers);
        if (!headers.has("x-share-token")) {
          headers.set("x-share-token", shareToken);
        }
        return originalFetch(input, { ...init, headers });
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [shareToken, canEdit, canComment]);

  // For edit/full: render the full interactive editor
  if (canEdit) {
    return (
      <div className="min-h-full pb-32">
        <div className="sticky top-0 z-30 flex items-center justify-end gap-2 bg-white/80 px-3 py-1.5 backdrop-blur dark:bg-[#191919]/80">
          <span className="mr-auto text-xs text-neutral-400">
            Shared with edit access
          </span>
          <button
            
            onClick={() => openComments(PAGE_ANCHOR)}
            aria-label="Comments"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <MessageSquare size={16} />
          </button>
        </div>

        {page.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.coverUrl} alt="" className="h-48 w-full object-cover" />
        )}

        <div className="mx-auto max-w-[836px] px-16">
          <div className={page.coverUrl ? "-mt-8" : "pt-16"}>
            {page.icon && (
              <span className="text-6xl leading-none"><PageIcon icon={page.icon} /></span>
            )}
          </div>

          <textarea
            
            rows={1}
            value={title}
            placeholder="Untitled"
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, "");
              setTitle(v);
              // Persist title change via the share-token-authed API
              void fetch(`/api/pages/${page.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title: v }),
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editorRef.current?.focusFirst();
              }
            }}
            className="mt-2 w-full resize-none overflow-hidden bg-transparent text-4xl font-bold text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />

          <BlockEditor
            ref={editorRef}
            pageId={page.id}
            initialBlocks={blocks}
            shareToken={shareToken}
          />
        </div>
        <CommentThreadPanel pageId={page.id} />
      </div>
    );
  }

  // For comment: read-only blocks + comment panel
  if (canComment) {
    return (
      <div className="min-h-full pb-32">
        <div className="sticky top-0 z-30 flex items-center justify-end gap-2 bg-white/80 px-3 py-1.5 backdrop-blur dark:bg-[#191919]/80">
          <span className="mr-auto text-xs text-neutral-400">
            Shared with comment access
          </span>
          <button
            
            onClick={() => openComments(PAGE_ANCHOR)}
            aria-label="Comments"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <MessageSquare size={16} />
          </button>
        </div>

        {page.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.coverUrl} alt="" className="h-48 w-full object-cover" />
        )}

        <div className="mx-auto max-w-[708px] px-6">
          <div className={page.coverUrl ? "-mt-8" : "pt-16"}>
            {page.icon && (
              <span className="text-6xl leading-none"><PageIcon icon={page.icon} /></span>
            )}
          </div>
          <h1 className="mt-2 text-4xl font-bold text-neutral-900 dark:text-neutral-100">
            {page.title || "Untitled"}
          </h1>
          <div className="mt-4">
            <ReadOnlyBlocks blocks={blocks} />
          </div>
        </div>
        <CommentThreadPanel pageId={page.id} />
      </div>
    );
  }

  // Default: view — should not reach here (handled by the Server Component)
  return null;
}
