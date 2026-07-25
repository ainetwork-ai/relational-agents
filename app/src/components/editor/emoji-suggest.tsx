"use client";

import { EMOJI } from "@/lib/editor/inline-autoformat";
import { EMOJI_CATEGORIES } from "@/lib/emoji-data";

export interface EmojiCandidate {
  emoji: string;
  label: string;
}

/** Candidates for the `:query` popup — shortcodes first (their names are the
 *  ones people type), then keyword matches from the full emoji dataset. */
export function emojiCandidates(query: string): EmojiCandidate[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: EmojiCandidate[] = [];
  const seen = new Set<string>();
  for (const [code, emoji] of Object.entries(EMOJI)) {
    if (code.startsWith(q) && !seen.has(emoji)) {
      out.push({ emoji, label: code });
      seen.add(emoji);
    }
  }
  outer: for (const cat of EMOJI_CATEGORIES) {
    for (const [emoji, terms] of cat.emojis) {
      if (out.length >= 12) break outer;
      if (seen.has(emoji)) continue;
      const words = terms.split(" ");
      if (words.some((t) => t.startsWith(q))) {
        out.push({ emoji, label: words[0] });
        seen.add(emoji);
      }
    }
  }
  return out.slice(0, 12);
}

/** Notion-style emoji autocomplete popup shown while typing `:que…`. */
export function EmojiSuggestMenu({
  anchor,
  query,
  selectedIndex,
  onPick,
}: {
  anchor: { x: number; y: number };
  query: string;
  selectedIndex: number;
  onPick: (item: EmojiCandidate) => void;
}) {
  const items = emojiCandidates(query);
  if (!items.length) return null;
  return (
    <div
      data-testid="emoji-suggest-menu"
      className="popover-anim fixed z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ left: anchor.x, top: anchor.y + 24 }}
    >
      {items.map((it, i) => (
        <button
          key={`${it.emoji}-${it.label}`}
          data-testid={`emoji-suggest-item-${it.label}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the editor selection
            onPick(it);
          }}
          className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-sm ${
            i === selectedIndex
              ? "bg-neutral-100 dark:bg-neutral-700"
              : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
          }`}
        >
          <span className="text-base">{it.emoji}</span>
          <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            :{it.label}:
          </span>
        </button>
      ))}
    </div>
  );
}
