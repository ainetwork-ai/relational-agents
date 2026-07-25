"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

export interface MentionPageItem {
  id: string;
  title: string;
  icon: string | null;
}

export interface MentionChip {
  id: string;
  title: string;
}

/** "@" context picker: typing "@" in the composer opens a dropdown over the
 *  GET /api/pages list. Selecting clears the "@query" from the input and
 *  moves it into a mention chip (demo — merged into the body as "@title" at
 *  send time). */
export function useMentionPicker(
  input: string,
  setInput: (value: string) => void,
  composerRef: React.RefObject<HTMLTextAreaElement | null>
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pages, setPages] = useState<MentionPageItem[]>([]);
  const [mentions, setMentions] = useState<MentionChip[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/pages")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data?.pages)) setPages(data.pages);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? pages.filter((p) => p.title.toLowerCase().includes(q)) : pages;
    return filtered.slice(0, 8);
  }, [pages, query]);

  useEffect(() => {
    if (selectedIndex >= items.length) setSelectedIndex(0);
  }, [items, selectedIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setTriggerStart(null);
    setQuery("");
  }, []);

  /** textarea onChange: update value + detect the "@query" at the caret. */
  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      const caret = composerRef.current?.selectionStart ?? value.length;
      const uptoCaret = value.slice(0, caret);
      const at = uptoCaret.lastIndexOf("@");
      if (at === -1 || /\s/.test(uptoCaret.slice(at + 1))) {
        setOpen(false);
        setTriggerStart(null);
        return;
      }
      // trigger only when "@" follows whitespace/start (avoids emails etc.)
      const before = at > 0 ? uptoCaret[at - 1] : "";
      if (before && !/\s/.test(before)) {
        setOpen(false);
        setTriggerStart(null);
        return;
      }
      setQuery(uptoCaret.slice(at + 1));
      setTriggerStart(at);
      setSelectedIndex(0);
      setOpen(true);
    },
    [setInput, composerRef]
  );

  const pick = useCallback(
    (item: MentionPageItem) => {
      setMentions((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, { id: item.id, title: item.title }]));
      if (triggerStart !== null) {
        const caret = composerRef.current?.selectionStart ?? input.length;
        const next = input.slice(0, triggerStart) + input.slice(caret);
        setInput(next);
        requestAnimationFrame(() => {
          composerRef.current?.setSelectionRange(triggerStart, triggerStart);
          composerRef.current?.focus();
        });
      }
      close();
    },
    [triggerStart, input, setInput, composerRef, close]
  );

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id));
  }, []);

  /** Intercept arrows/Enter/ESC while the dropdown is open. Returning true
   *  tells the caller to skip its own default (send/blur). */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (items.length ? (i + 1) % items.length : 0));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (items[selectedIndex]) pick(items[selectedIndex]);
        else close();
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [open, items, selectedIndex, pick, close]
  );

  const clear = useCallback(() => setMentions([]), []);

  /** String merged into the body at send time: "@title1 @title2" */
  const serialize = useCallback(() => mentions.map((m) => `@${m.title}`).join(" "), [mentions]);

  return {
    open,
    items,
    selectedIndex,
    setSelectedIndex,
    mentions,
    handleInputChange,
    handleKeyDown,
    pick,
    removeMention,
    close,
    clear,
    serialize,
  };
}

/** The "@" dropdown. Arrow-key movement is handled above (useMentionPicker.handleKeyDown). */
export function MentionDropdown({
  open,
  items,
  selectedIndex,
  onPick,
  onHover,
}: {
  open: boolean;
  items: MentionPageItem[];
  selectedIndex: number;
  onPick: (item: MentionPageItem) => void;
  onHover: (index: number) => void;
}) {
  if (!open) return null;
  return (
    <div
      data-testid="mention-menu"
      role="listbox"
      className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
    >
      {items.length === 0 ? (
        <p data-testid="mention-empty" className="px-3 py-2 text-xs text-neutral-400">
          No matching pages
        </p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            data-testid={`mention-item-${item.id}`}
            role="option"
            aria-selected={i === selectedIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
              i === selectedIndex
                ? "bg-neutral-100 dark:bg-neutral-700"
                : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
            }`}
          >
            <span className="shrink-0">{item.icon ?? "📄"}</span>
            <span className="truncate text-neutral-800 dark:text-neutral-200">{item.title}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** Selected mention chip list. */
export function MentionChips({
  mentions,
  onRemove,
}: {
  mentions: MentionChip[];
  onRemove: (id: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div data-testid="mentions-list" className="mb-2 flex flex-wrap gap-1.5">
      {mentions.map((m) => (
        <div
          key={m.id}
          data-testid={`mention-chip-${m.id}`}
          className="flex items-center gap-1 rounded-md bg-blue-50 py-1 pl-2 pr-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
        >
          <span className="max-w-[10rem] truncate">@{m.title}</span>
          <button
            type="button"
            data-testid={`mention-remove-${m.id}`}
            onClick={() => onRemove(m.id)}
            aria-label={`Remove mention ${m.title}`}
            className="rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
