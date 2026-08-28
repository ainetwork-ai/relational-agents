"use client";

import { useEffect, useRef, useState } from "react";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { useDebounced } from "@/hooks/use-debounced";
import { useRecentsStore } from "@/stores/recents";
import { usePagesStore } from "@/stores/pages";
import { PageIcon } from "@/components/page-icon";
import { MemorySelect } from "@/components/database/memory-select";
import { useT } from "@/i18n/provider";

interface SearchResult {
  id: string;
  title: string;
  icon: string | null;
  snippet: string | null;
  /** OKF node kind, when the result comes from the file store */
  kind?: string;
  /** parent page title — breadcrumb context under the result */
  path?: string | null;
}

/** Wrap case-insensitive occurrences of `q` in the snippet with a highlight. */
function highlightMatch(text: string, q: string) {
  const query = q.trim();
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        data-testid="search-highlight"
        className="bg-transparent font-semibold text-neutral-800 dark:text-neutral-100"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function SearchModal() {
  const t = useT();
  const router = useRouter();
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<{
    answer: string;
    sources: { id: string; title: string }[];
  } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(0);
 // result filters (type / edited window / created by me)
  const [fType, setFType] = useState("");
  const [fEdited, setFEdited] = useState("");
  const [fMe, setFMe] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentIds = useRecentsStore((s) => s.ids);
  const pages = usePagesStore((s) => s.pages);
  const recents = recentIds.map((id) => pages[id]).filter(Boolean).slice(0, 8);

 // global Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
 // with text selected in the editor, Cmd+K means "add link" instead
        const sel = window.getSelection();
        const anchor =
          sel?.anchorNode instanceof Element
            ? sel.anchorNode
            : sel?.anchorNode?.parentElement;
        if (
          sel &&
          !sel.isCollapsed &&
          anchor?.closest('[data-testid^="block-editable-"]')
        ) {
          return;
        }
        e.preventDefault();
        setOpen(!useUiStore.getState().searchOpen);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const runSearch = useDebounced(async (q: string, type: string = "", ed: string = "", me: boolean = false) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    const params = new URLSearchParams({ q });
    if (type) params.set("type", type);
    if (ed) params.set("edited", ed);
    if (me) params.set("creator", "me");
    const res = await fetch(`/api/search?${params.toString()}`);
    if (res.ok) {
      const { results } = await res.json();
      setResults(results);
      setSearched(true);
      setSelected(0);
    }
  }, 200);

  function rememberQuery(q: string) {
    if (!q.trim()) return;
    try {
      const key = "recent-searches";
      const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
      const next = [q.trim(), ...cur.filter((x) => x !== q.trim())].slice(0, 5);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  function recentQueries(): string[] {
    try {
      return JSON.parse(localStorage.getItem("recent-searches") ?? "[]");
    } catch {
      return [];
    }
  }

  function go(id: string) {
    rememberQuery(query);
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    router.push(`/p/${id}`);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-[2px] pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        data-testid="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("빠른 검색")}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <Search size={16} className="shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            autoFocus
            data-testid="search-input"
            value={query}
            placeholder={t("페이지 검색…")}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch.call(e.target.value, fType, fEdited, fMe);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (!isImeComposing(e) && e.key === "Enter" && results[selected]) {
                go(results[selected].id);
              }
            }}
            className="w-full bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200"
          />
          <kbd className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-400 dark:border-neutral-600">
            ESC
          </kbd>
        </div>
        {/* result filters */}
        <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-1.5 text-xs dark:border-neutral-700">
          <MemorySelect
            testid="search-filter-type"
            value={fType}
            searchable={false}
            options={[
              { value: "", label: t("모든 유형") },
              { value: "page", label: t("페이지") },
              { value: "database", label: t("데이터베이스") },
            ]}
            onChange={(v) => {
              setFType(v);
              runSearch.call(query, v, fEdited, fMe);
            }}
          />
          <MemorySelect
            testid="search-filter-date"
            value={fEdited}
            searchable={false}
            options={[
              { value: "", label: t("모든 기간") },
              { value: "today", label: t("오늘 편집됨") },
              { value: "week", label: t("지난 1주") },
              { value: "month", label: t("지난 1개월") },
            ]}
            onChange={(v) => {
              setFEdited(v);
              runSearch.call(query, fType, v, fMe);
            }}
          />
          <button
            data-testid="search-filter-me"
            onClick={() => {
              const next = !fMe;
              setFMe(next);
              runSearch.call(query, fType, fEdited, next);
            }}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              fMe
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                : "border-neutral-200 text-neutral-500 dark:border-neutral-600 dark:text-neutral-300"
            }`}
          >
            {t("내가 생성")}
          </button>
        </div>

        {query.trim() && (
          <div className="border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
            <button
              data-testid="search-ai-ask"
              disabled={aiBusy}
              onClick={() => {
                setAiBusy(true);
                setAiAnswer(null);
                void fetch("/api/ai/qa", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ question: query }),
                })
                  .then(async (r) => (r.ok ? r.json() : null))
                  .then((d) => setAiAnswer(d))
                  .catch(() => setAiAnswer(null))
                  .finally(() => setAiBusy(false));
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-60 dark:text-purple-300 dark:hover:bg-purple-900/20"
            >
              ✨ {aiBusy ? t("AI에게 묻는 중…") : t("AI에게 묻기: “{q}”", { q: query })}
            </button>
            {aiAnswer && (
              <div
                data-testid="search-ai-answer"
                className="mt-1 whitespace-pre-wrap rounded-md bg-purple-50/60 px-3 py-2 text-sm text-neutral-800 dark:bg-purple-900/20 dark:text-neutral-200"
              >
                {aiAnswer.answer}
                {aiAnswer.sources.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-neutral-500">
                    {aiAnswer.sources.map((src) => (
                      <a
                        key={src.id}
                        data-testid={`search-ai-source-${src.id}`}
                        href={`/p/${src.id}`}
                        className="rounded bg-white/70 px-1.5 py-0.5 hover:underline dark:bg-neutral-800"
                      >
                        {src.title}
                      </a>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            query.trim() && searched ? (
              <p
                data-testid="search-empty"
                className="px-3 py-8 text-center text-sm text-neutral-400"
              >
                {t("“{q}”에 대한 결과가 없습니다", { q: query })}
              </p>
            ) : recents.length > 0 || recentQueries().length > 0 ? (
              <div data-testid="search-recent">
                {recentQueries().length > 0 && (
                  <>
                    <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                      {t("최근 검색")}
                    </p>
                    <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                      {recentQueries().map((rq, i) => (
                        <button
                          key={rq}
                          data-testid={`search-recent-q-${i}`}
                          onClick={() => {
                            setQuery(rq);
                            runSearch.call(rq, fType, fEdited, fMe);
                          }}
                          className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        >
                          {rq}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  {t("최근")}
                </p>
                {recents.map((r) => (
                  <button
                    key={r.id}
                    data-testid={`search-recent-${r.id}`}
                    onClick={() => go(r.id)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
                  >
                    <span className="shrink-0 text-base"><PageIcon icon={r.icon} fallback="📄" /></span>
                    <span className="min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-200">
                      {r.title || t("제목 없음")}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-neutral-400">
                {t("페이지 제목이나 내용으로 검색")}
              </p>
            )
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                data-testid={
                  r.kind === "database" ? `search-result-db-${r.id}` : `search-result-${r.id}`
                }
                onClick={() => go(r.id)}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
                  i === selected
                    ? "bg-neutral-100 dark:bg-neutral-700"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
                }`}
              >
                <span className="shrink-0 text-base"><PageIcon icon={r.icon} fallback="📄" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-neutral-800 dark:text-neutral-200">
                    {r.title || t("제목 없음")}
                  </span>
                  {r.path && (
                    <span
                      data-testid={`search-result-path-${r.id}`}
                      className="block truncate text-[11px] text-neutral-400"
                    >
                      {t("{path} 안", { path: r.path })}
                    </span>
                  )}
                  {r.snippet && (
                    <span className="block truncate text-xs text-neutral-400">
                      {highlightMatch(r.snippet, query)}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          data-testid="search-hint-footer"
          className="flex items-center gap-3 border-t border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-800"
        >
          <span><kbd className="rounded border border-neutral-200 px-1 dark:border-neutral-600">↑↓</kbd> {t("이동")}</span>
          <span><kbd className="rounded border border-neutral-200 px-1 dark:border-neutral-600">↵</kbd> {t("열기")}</span>
          <span><kbd className="rounded border border-neutral-200 px-1 dark:border-neutral-600">esc</kbd> {t("닫기")}</span>
        </div>
      </div>
    </div>
  );
}
