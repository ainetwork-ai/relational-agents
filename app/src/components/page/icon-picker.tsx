"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnchored } from "@/hooks/use-anchored";
import { createPortal } from "react-dom";
import { Shuffle } from "lucide-react";
import {
  SKIN_TONES,
  applySkinTone,
  countEmojiMatches,
  drawableEmojis,
  emojiCategories,
  emojiLabel,
  emojiSetReady,
  loadEmojiSet,
  randomEmoji,
  searchEmoji,
} from "@/lib/emoji-data";
import { uploadBlob } from "@/lib/upload";
import { PageIcon } from "@/components/page-icon";

export function IconPicker({
  icon,
  onChange,
  testid = "page-icon",
  pickerTestid = "icon-picker",
  triggerClassName = "rounded-md p-1 text-7xl leading-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800",
  placeholder = "📄",
  allowRemove = true,
  allowImage = false,
}: {
  icon: string | null;
  onChange: (icon: string | null) => void;
  /** override testids/trigger so the picker can be reused (e.g. in a callout). */
  testid?: string;
  pickerTestid?: string;
  triggerClassName?: string;
  placeholder?: React.ReactNode;
  allowRemove?: boolean;
  /** page icons also accept uploaded/URL images */
  allowImage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"emoji" | "upload" | "url">("emoji");
  const [urlDraft, setUrlDraft] = useState("");
  const [activeCategory, setActiveCategory] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
 // Focus the search input when the picker opens
    requestAnimationFrame(() => searchRef.current?.focus());
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

 // The ~1.9k emoji catalogue is a separate chunk — nobody needs it until a
 // picker is actually opened, so fetch it here and re-render when it lands
  const [ready, setReady] = useState(emojiSetReady);
  useEffect(() => {
    if (!open || ready) return;
    let live = true;
    void loadEmojiSet().then((ok) => {
      if (live && ok) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [open, ready]);

  const categories = useMemo(() => (ready ? emojiCategories() : []), [ready]);

  const search = useMemo(() => {
    const q = query.trim();
 // no categories yet means the catalogue is still loading, and searching it
 // would only come up empty
    if (!q || !categories.length) return null; // show categories view
    const results = searchEmoji(q);
    const total = countEmojiMatches(q);
    return { results, hidden: total - results.length };
  }, [query, categories]);

 // Which rows the grid shows: search hits, or the active category minus
 // anything this platform's font cannot draw
  const rows = useMemo(
    () =>
      search?.results ??
      (categories[activeCategory] ? drawableEmojis(categories[activeCategory]) : []),
    [search, categories, activeCategory]
  );

 // Skin tone — 0 is the default yellow, 1–5 the Fitzpatrick modifiers
  const [skin, setSkin] = useState(() => {
    try {
      return Number(localStorage.getItem("emoji-skin") ?? 0) || 0;
    } catch {
      return 0;
    }
  });
  const applySkin = (emoji: string) => applySkinTone(emoji, skin);
  function cycleSkin() {
    const next = (skin + 1) % (SKIN_TONES.length + 1);
    setSkin(next);
    try {
      localStorage.setItem("emoji-skin", String(next));
    } catch {}
  }

  function pickRandom() {
    const emoji = randomEmoji();
    onChange(emoji);
    setOpen(false);
    setQuery("");
  }

  function pick(emoji: string) {
    try {
      const key = "recent-emoji";
      const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
      localStorage.setItem(
        key,
        JSON.stringify([emoji, ...cur.filter((e) => e !== emoji)].slice(0, 9))
      );
    } catch {}
    onChange(emoji);
    setOpen(false);
    setQuery("");
  }
  function recentEmoji(): string[] {
    try {
      return JSON.parse(localStorage.getItem("recent-emoji") ?? "[]");
    } catch {
      return [];
    }
  }

 // portalled and placed — inside the page's scroller this popover was cut off
 // when its trigger sat low in the window
  useAnchored(open, btnRef, popRef, { align: "start" });

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
        aria-label="Change icon"
      >
        <PageIcon icon={icon} fallback={placeholder} className="inline-block h-[1em] w-[1em] rounded object-cover align-[-0.1em]" />
      </button>

      {open &&
        createPortal(
          <div
          data-testid={pickerTestid}
          ref={popRef}
            style={{ visibility: "hidden" }}
            className="popover-anim fixed z-50 overflow-y-auto w-80 rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        >
          {allowImage && (
            <div className="flex gap-1 border-b border-neutral-100 px-2 py-1.5 text-xs dark:border-neutral-700">
              {(["emoji", "upload", "url"] as const).map((t) => (
                <button
                  key={t}
                  data-testid={`icon-tab-${t}`}
                  onClick={() => setTab(t)}
                  className={`rounded px-2 py-0.5 capitalize transition-colors ${
                    tab === t
                      ? "bg-neutral-100 font-medium text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100"
                      : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
                  }`}
                >
                  {t === "url" ? "Link" : t}
                </button>
              ))}
            </div>
          )}
          {tab === "upload" && (
            <div className="p-3">
              <label className="block cursor-pointer rounded border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 dark:border-neutral-600">
                ⬆ Upload an image…
                <input
                  data-testid="icon-upload-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void (async () => {
                      const up = await uploadBlob(f);
                      if (!up) return;
                      onChange(up.url);
                      setOpen(false);
                      setTab("emoji");
                    })();
                  }}
                />
              </label>
            </div>
          )}
          {tab === "url" && (
            <div className="flex gap-1.5 p-3">
              <input
                autoFocus
                data-testid="icon-url-input"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="Paste an image link…"
                className="w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <button
                data-testid="icon-url-save"
                onClick={() => {
                  if (urlDraft.trim()) {
                    onChange(urlDraft.trim());
                    setOpen(false);
                    setTab("emoji");
                    setUrlDraft("");
                  }
                }}
                className="rounded bg-blue-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600"
              >
                Save
              </button>
            </div>
          )}
          {tab === "emoji" && (
            <>
          {/* Search bar */}
          <div className="flex items-center gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
            <input
              ref={searchRef}
              data-testid="icon-picker-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji…"
              className="flex-1 bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 dark:text-neutral-200"
            />
            <button
              data-testid="icon-picker-random"
              onClick={pickRandom}
              aria-label="Random emoji"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
            >
              <Shuffle size={14} />
            </button>
            <button
              onClick={cycleSkin}
              data-testid="icon-skin-tone"
              aria-label="Skin tone"
              data-tip="Skin tone"
              className="rounded p-1 text-base transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              {applySkin("\u270B") /* ✋ preview of the active tone */}
            </button>
          </div>

          {/* Recently used */}
          {!search && recentEmoji().length > 0 && (
            <div className="border-b border-neutral-100 px-2 py-1 dark:border-neutral-700">
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                Recent
              </p>
              <div className="flex gap-0.5">
                {recentEmoji().map((e, i) => (
                  <button
                    key={`${e}-${i}`}
                    data-testid={`icon-recent-${i}`}
                    onClick={() => pick(e)}
                    title={emojiLabel(e)}
                    aria-label={emojiLabel(e) ?? e}
                    className="rounded p-1 text-lg transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Category tabs (hidden when searching) */}
          {!search && (
            <div className="flex gap-0.5 overflow-x-auto border-b border-neutral-100 px-1 py-1 dark:border-neutral-700">
              {categories.map((cat, i) => (
                <button
                  key={cat.name}
                  onClick={() => {
                    setActiveCategory(i);
 // Scroll the grid to top when switching categories
                    gridRef.current?.scrollTo(0, 0);
                  }}
                  aria-label={cat.name}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-base transition-colors ${
                    i === activeCategory
                      ? "bg-neutral-100 dark:bg-neutral-700"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
                  }`}
                >
                  {cat.icon}
                </button>
              ))}
            </div>
          )}

          {/* Emoji grid — search hits, or the active category */}
          <div ref={gridRef} className="max-h-56 overflow-y-auto p-1.5">
            {!ready ? (
              <p className="py-4 text-center text-xs text-neutral-400">Loading emoji…</p>
            ) : rows.length === 0 ? (
              <p className="py-4 text-center text-xs text-neutral-400">No emoji found</p>
            ) : (
              <>
                <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  {search
                    ? `${rows.length} result${rows.length === 1 ? "" : "s"}`
                    : categories[activeCategory]?.name}
                </p>
                <div className="grid grid-cols-9 gap-0.5">
                  {rows.map(({ emoji, label }) => {
                    const toned = applySkin(emoji);
                    return (
                      <button
                        key={emoji}
                        onClick={() => pick(toned)}
                        title={label}
                        aria-label={label}
                        className="rounded p-1 text-lg transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
                      >
                        {toned}
                      </button>
                    );
                  })}
                </div>
                {/* the cap only bites on very broad queries, but say so rather
                    than pretending the list is complete */}
                {search && search.hidden > 0 && (
                  <p className="px-1 pt-1.5 text-[10px] text-neutral-400">
                    +{search.hidden} more — keep typing to narrow it down
                  </p>
                )}
              </>
            )}
          </div>
            </>
          )}

          {/* Remove icon */}
          {allowRemove && (
            <div className="border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full rounded px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Remove icon
              </button>
            </div>
          )}
        </div>,
          document.body
        )}
    </div>
  );
}
