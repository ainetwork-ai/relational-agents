"use client";

import { useEffect, useState } from "react";
import { emojiSetReady, loadEmojiSet, searchEmoji, searchShortcodes } from "@/lib/emoji-data";

export interface EmojiCandidate {
  emoji: string;
  /** what the row reads as: a shortcode, or the emoji's name */
  label: string;
  /** set when `label` is a real `:shortcode:` and can be shown as one */
  code?: string;
}

const LIMIT = 12;
/** Keep room for name matches even when a short prefix has plenty of
 * shortcodes: typing ":cat" should still be able to reach 🐈‍⬛. */
const SHORTCODE_SLOTS = 8;

/** Candidates for the `:query` popup — shortcodes first (their names are the
 * ones people type), then name/keyword matches across the whole emoji set. */
export function emojiCandidates(query: string): EmojiCandidate[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: EmojiCandidate[] = [];
  const seen = new Set<string>();
  for (const [code, emoji] of searchShortcodes(q, SHORTCODE_SLOTS)) {
    out.push({ emoji, label: code, code });
    seen.add(emoji);
  }
  for (const { emoji, label } of searchEmoji(q, LIMIT)) {
    if (out.length >= LIMIT) break;
    if (seen.has(emoji)) continue;
    out.push({ emoji, label });
    seen.add(emoji);
  }
  return out.slice(0, LIMIT);
}

/** emoji autocomplete popup shown while typing `:que…`. */
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
 // the editor starts the catalogue chunk on the opening ':'; if it has not
 // arrived yet, re-render once it does instead of leaving the legacy few on
 // screen until the next keystroke
  const [ready, setReady] = useState(emojiSetReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadEmojiSet().then((ok) => {
      if (live && ok) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

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
            {it.code ? `:${it.code}:` : it.label}
          </span>
        </button>
      ))}
    </div>
  );
}
