"use client";

import { useEffect, useRef, useState } from "react";
import {
  Share2,
  Copy,
  FilePlus2,
  Send,
  Square,
  RefreshCw,
  Plug,
  Bell,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Quote,
  Pencil,
} from "lucide-react";
import { copyText, newId } from "@/lib/compat";
import { MarkdownContent } from "./markdown";
import { useAiChatsStore } from "@/stores/ai-chats";
import { ConnectorsPanel } from "@/components/chat/connectors-panel";
import { NotifSettings } from "@/components/chat/notif-settings";
import { UsageMeter, type UsageState } from "@/components/chat/usage-meter";
import { useComposerAttachments, AttachButton, AttachmentsList } from "@/components/chat/composer-attachments";
import { useMentionPicker, MentionDropdown, MentionChips } from "@/components/chat/mention-picker";

type ChatMeta = {
  id: string;
  title: string;
  icon: string | null;
  agentName: string | null;
  isFavorite: boolean;
  hasUnread: boolean;
  shareToken: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { id: string; title: string }[];
  createdAt: string;
};

/** Fields carried by delta/done/error events (contract with the server messages route). */
interface SseEventData {
  delta?: string;
  messageId?: string;
  sources?: { id: string; title: string }[];
  message?: string;
  /** B. distinguishable error kind (ratelimit/server) — e2e determinism hook only; absent = generic error. */
  kind?: string;
}

/** Parse one `event: x\ndata: {...}` block from an SSE stream. */
function parseSseEvent(raw: string): { event: string; data: SseEventData } | null {
  let event = "message";
  let dataStr = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

/** A. Message timestamps: relative-time ("just now"/"N min ago"/…) default formatter. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

// A. Long-chat pagination: deterministic e2e hook — a localStorage page size,
// when present, becomes the initial-load limit (tests set it small to surface
// the "load more" button deterministically). Otherwise the server default
// (50) applies, so ordinary chats are unaffected.
function getMsgPageSize(): number {
  try {
    const raw = localStorage.getItem("ai-msg-page-size");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
  } catch {
    return 50;
  }
}

// B. composer character counter/warning cap — shares the server's MAX_TEXT (20,000).
const MAX_CHARS = 20_000;
const CHAR_WARN_THRESHOLD = 18_000;

export function ChatView({ chatId }: { chatId: string }) {
  const [chat, setChat] = useState<ChatMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
 // B. distinguishable error kind (ratelimit/server) — the banner shows a matching badge.
  const [errorKind, setErrorKind] = useState<"ratelimit" | "server" | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [usage, setUsage] = useState<UsageState | null>(null);
 // per-message feedback (like/dislike/report) is local state only — survives no refresh (demo).
  const [feedback, setFeedback] = useState<Record<string, { vote?: "up" | "down"; reported?: boolean }>>(
    {}
  );
  const [reportToast, setReportToast] = useState(false);
 // B. edit-resend: only tracks whether the last user message is being edited (simplified).
  const [isEditing, setIsEditing] = useState(false);
 // C. context-scope picker: no real search scoping needed — UI state only.
  const [contextScope, setContextScope] = useState<"workspace" | "page">("workspace");
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
 // A. long-chat pagination: whether to show "load earlier messages" when the server sent only the latest N.
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const isComposingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
 // A. skip one auto-scroll-to-bottom when prepending older messages (distinct from new arrivals).
  const skipAutoScrollRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
 // A. draft persistence: chatIdRef keeps the load/save effects from racing
 // in the same commit and saving the old chat's text under the new chat's key.
  const chatIdRef = useRef(chatId);
  const attach = useComposerAttachments();
  const mention = useMentionPicker(input, setInput, composerRef);

 // auto-focus the composer on entering a chat
  useEffect(() => {
    if (!loading) composerRef.current?.focus();
  }, [loading, chatId]);

 // C. Cmd/Ctrl+K → focus the composer (chat view only). The sidebar's global
 // search also grabs Cmd/Ctrl+K on window keydown (bubble phase), so we
 // intercept in the capture phase and stopPropagation so global search never
 // opens (regression guard).
  useEffect(() => {
    function onKeyDownCapture(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        composerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => window.removeEventListener("keydown", onKeyDownCapture, true);
  }, []);

 // A. draft persistence: switching chats restores that chat's saved draft
 // (a successful send clears the input, and the save effect below clears the
 // localStorage key at that moment).
  useEffect(() => {
    chatIdRef.current = chatId;
    setIsEditing(false);
    try {
      setInput(localStorage.getItem(`ai-chat-draft:${chatId}`) ?? "");
    } catch {
      setInput("");
    }
  }, [chatId]);

  useEffect(() => {
    const key = `ai-chat-draft:${chatIdRef.current}`;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {}
  }, [input]);

 // B. composer auto-grow: height follows content, capped by max-h-40 (CSS).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    let alive = true;
 // fetch-on-mount: subsequent setState only fires async after the fetch
 // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
 // A. long chats: the initial load asks for only the latest N (default 50 — ordinary chats unaffected).
    fetch(`/api/ai/chats/${chatId}?limit=${getMsgPageSize()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setChat(data.chat);
        setMessages(data.messages ?? []);
        setHasMoreMessages(!!data.hasMore);
        if (data.chat?.shareToken) {
          setShareUrl(`${window.location.origin}/share/chat/${data.chat.shareToken}`);
        }
        if (data.chat?.hasUnread) {
          fetch(`/api/ai/chats/${chatId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ markRead: true }),
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [chatId]);

  useEffect(() => {
 // A. right after "load earlier messages" prepends history, skip the auto-scroll-to-bottom.
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText]);

  /** A. Load earlier messages: fetch the previous page via the before cursor and prepend (scroll position preserved best-effort). */
  async function handleLoadOlder() {
    if (loadingOlder || messages.length === 0) return;
    const oldest = messages[0];
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/ai/chats/${chatId}/messages?before=${encodeURIComponent(oldest.createdAt)}`
      );
      if (res.ok) {
        const data = await res.json();
        const older: ChatMessage[] = data.messages ?? [];
        if (older.length > 0) {
          skipAutoScrollRef.current = true;
          setMessages((prev) => [...older, ...prev]);
          requestAnimationFrame(() => {
            if (!container) return;
            container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
          });
        }
        setHasMoreMessages(!!data.hasMore);
      }
    } catch {
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadUsage() {
    try {
      const res = await fetch("/api/ai/usage");
      if (res.ok) setUsage(await res.json());
    } catch {}
  }

  useEffect(() => {
    void loadUsage();
  }, []);

  async function handleUpgrade() {
    try {
      const res = await fetch("/api/ai/usage", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "plus" }),
      });
      if (res.ok) setUsage(await res.json());
    } catch {}
  }

  /** Shared stream consumption: send and regenerate use the same SSE parse/settle logic. */
  async function runStream(requestBody: Record<string, unknown>) {
    setError(null);
    setErrorKind(null);
    setStreaming(true);
    setStreamingText("");
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      const res = await fetch(`/api/ai/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ present: true, ...requestBody }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let msg = "Failed to send";
        try {
          const errBody = await res.clone().json();
          if (typeof errBody?.error === "string") msg = errBody.error;
        } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const evt = parseSseEvent(rawEvent);
          if (!evt) continue;
          if (evt.event === "delta") {
            acc += evt.data?.delta ?? "";
            setStreamingText(acc);
          } else if (evt.event === "done") {
            setMessages((prev) => [
              ...prev,
              {
                id: evt.data?.messageId ?? newId(),
                role: "assistant",
                content: acc,
                sources: evt.data?.sources ?? [],
                createdAt: new Date().toISOString(),
              },
            ]);
            setStreamingText("");
            setStreaming(false);
 // sync the sidebar list: the first message derives the title, so refresh header/store
            fetch(`/api/ai/chats/${chatId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                if (d?.chat) setChat(d.chat);
              })
              .catch(() => {});
            void useAiChatsStore.getState().load();
          } else if (evt.event === "error") {
            setError(evt.data?.message ?? "Something went wrong");
            setErrorKind(
              evt.data?.kind === "ratelimit" || evt.data?.kind === "server" ? evt.data.kind : null
            );
            setStreamingText("");
            setStreaming(false);
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        if (acc) {
          setMessages((prev) => [
            ...prev,
            { id: newId(), role: "assistant", content: acc, createdAt: new Date().toISOString() },
          ]);
        }
      } else {
        setError(err instanceof Error && err.message ? err.message : "Something went wrong while sending the message");
        setErrorKind(null);
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      abortRef.current = null;
 // return focus to the composer when the reply completes
      composerRef.current?.focus();
 // usage-gating mock: refresh the count on every send (success or not)
      void loadUsage();
    }
  }

  const composerDisabled = !!(
    usage &&
    (usage.aiDisabledByAdmin || (usage.plan === "free" && usage.messageCount >= usage.monthlyLimit))
  );

  async function handleSend() {
 // attachments/mentions ship only merged into the body (send/stream logic untouched).
    const mentionText = mention.serialize();
    const text = [input.trim(), mentionText].filter(Boolean).join(" ") + attach.serialize();
    if (!text.trim() || streaming || composerDisabled) return;
    const wasEditing = isEditing;
    setMessages((prev) => {
 // B. edit-resend: trim from the last user message on (it + the reply) and replace with a fresh turn.
      const lastUserIdx = prev.map((m) => m.role).lastIndexOf("user");
      const base = wasEditing && lastUserIdx !== -1 ? prev.slice(0, lastUserIdx) : prev;
      return [
        ...base,
        { id: newId(), role: "user", content: text, createdAt: new Date().toISOString() },
      ];
    });
    setIsEditing(false);
    setInput("");
    mention.clear();
    attach.clear();
    await runStream({ text });
  }

  /** Retry: resend the last user message (unlike regenerate, it's already on screen). */
  async function handleRetry() {
    if (streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
 // retry explicitly disables the failure hook (no repeating the previous failure).
    await runStream({ text: lastUser.content, failOnce: false });
  }

  async function handleRegenerate() {
    if (streaming) return;
 // remove the last assistant message from view and answer the same prompt again.
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant") {
          copy.splice(i, 1);
          break;
        }
      }
      return copy;
    });
    await runStream({ regenerate: true });
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      if (isComposingRef.current || e.nativeEvent.isComposing || composerDisabled) return;
      e.preventDefault();
      void handleSend();
    } else if (e.key === "Escape") {
 // ESC: blur the input
      e.currentTarget.blur();
    }
  }

  async function handleShare() {
    try {
      const res = await fetch(`/api/ai/chats/${chatId}/share`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      setShareUrl(`${window.location.origin}${data.url}`);
    } catch {}
  }

  async function handleRevokeShare() {
    try {
      await fetch(`/api/ai/chats/${chatId}/share`, { method: "DELETE" });
      setShareUrl(null);
    } catch {}
  }

  async function handleCopyShare() {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    if (ok) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    }
  }

  async function createPageFromContent(content: string) {
    try {
      const title = chat?.title || "Untitled";
      const pageRes = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!pageRes.ok) return;
      const { page } = await pageRes.json();
      await fetch(`/api/pages/${page.id}/blocks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "paragraph", content: { text: content } }),
      });
      window.location.href = `/p/${page.id}`;
    } catch {}
  }

  /** Like/dislike toggle: reclicking clears, the opposite replaces (mutually exclusive). */
  function handleVote(messageId: string, vote: "up" | "down") {
    setFeedback((prev) => {
      const cur = prev[messageId]?.vote === vote ? undefined : vote;
      return { ...prev, [messageId]: { ...prev[messageId], vote: cur } };
    });
  }

  function handleReport(messageId: string) {
    setFeedback((prev) => ({ ...prev, [messageId]: { ...prev[messageId], reported: true } }));
    setReportToast(true);
    setTimeout(() => setReportToast(false), 2000);
  }

  /** Quote-and-ask: prefill the composer with the message's first 100 chars as "> " and focus. */
  function handleQuoteAsk(content: string) {
    const quoted = content.trim().slice(0, 100);
    setInput(`> ${quoted}\n\n`);
    composerRef.current?.focus();
  }

  /** B. Edit the last user message: fill the composer and switch to edit mode. */
  function handleEditLast(content: string) {
    setIsEditing(true);
    setInput(content);
    composerRef.current?.focus();
  }

  function handleCancelEdit() {
    setIsEditing(false);
    setInput("");
  }

  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white dark:bg-[#191919]">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2">
          <h1
            data-testid="chat-title"
            className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200"
          >
            {chat?.icon ? `${chat.icon} ` : ""}
            {chat?.title ?? (loading ? "Loading…" : "Untitled chat")}
          </h1>
          {chat?.agentName && (
            <span
              data-testid="chat-agent-badge"
              className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            >
              {chat.agentName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="chat-connectors-btn"
            onClick={() => {
              setShowNotif(false);
              setShowConnectors((v) => !v);
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Plug size={14} />
            Connectors
          </button>
          <button
            type="button"
            data-testid="chat-notif-btn"
            onClick={() => {
              setShowConnectors(false);
              setShowNotif((v) => !v);
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Bell size={14} />
            Notifications
          </button>
          <button
            type="button"
            data-testid="chat-share"
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Share2 size={14} />
            Share
          </button>
        </div>
      </header>

      {showConnectors && <ConnectorsPanel onClose={() => setShowConnectors(false)} />}
      {showNotif && <NotifSettings onClose={() => setShowNotif(false)} />}

      {shareUrl && (
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <span
            data-testid="chat-share-url"
            className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300"
          >
            {shareUrl}
          </span>
          <button
            type="button"
            data-testid="chat-share-copy"
            onClick={handleCopyShare}
            className="shrink-0 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            {shareCopied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            data-testid="chat-share-revoke"
            onClick={handleRevokeShare}
            className="shrink-0 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            Unshare
          </button>
        </div>
      )}

      {error && (
        <div
          data-testid="chat-error-banner"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-500 dark:border-red-950/40 dark:bg-red-950/20 dark:text-red-400"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {errorKind === "ratelimit" && (
              <span
                data-testid="chat-error-ratelimit"
                className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/50 dark:text-red-300"
              >
                Rate limit
              </span>
            )}
            {errorKind === "server" && (
              <span
                data-testid="chat-error-server"
                className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/50 dark:text-red-300"
              >
                Server error
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{error}</span>
          </span>
          <button
            type="button"
            data-testid="chat-retry-btn"
            onClick={() => void handleRetry()}
            className="shrink-0 rounded px-2 py-1 font-medium text-red-600 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Retry
          </button>
        </div>
      )}

      {reportToast && (
        <div
          data-testid="chat-report-done"
          className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-neutral-200 dark:text-neutral-900"
        >
          Report submitted
        </div>
      )}

      <div
        ref={messagesContainerRef}
        data-testid="chat-messages"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {hasMoreMessages && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              data-testid="messages-load-older"
              onClick={() => void handleLoadOlder()}
              disabled={loadingOlder}
              className="rounded-md px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={m.id}
            data-role={m.role}
            data-last-assistant={m.role === "assistant" && i === messages.length - 1 ? "1" : undefined}
            data-testid={m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}
            className={`group flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                m.role === "user"
                  ? "bg-blue-50 text-neutral-900 dark:bg-blue-900/30 dark:text-neutral-100"
                  : "bg-neutral-50 dark:bg-neutral-800/60"
              }`}
            >
              {m.role === "user" ? (
                <>
                  <div className="flex items-start gap-1">
                    <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
                      {m.content}
                    </p>
                    {i === lastUserIndex && (
                      <button
                        type="button"
                        data-testid="chat-edit-last"
                        onClick={() => handleEditLast(m.content)}
                        className="shrink-0 rounded p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </div>
                  <p
                    data-testid={`msg-time-${m.id}`}
                    title={new Date(m.createdAt).toLocaleString()}
                    className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-400 dark:text-neutral-500"
                  >
                    <span>{formatRelativeTime(m.createdAt)}</span>
                    <span
                      data-testid="msg-time-abs"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ({new Date(m.createdAt).toLocaleString()})
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div data-testid="chat-msg-content">
                    <MarkdownContent content={m.content} />
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div
                      data-testid="chat-sources"
                      className="mt-2 space-y-0.5 text-xs text-neutral-400 dark:text-neutral-500"
                    >
                      <p>Sources</p>
                      <ul className="space-y-0.5">
                        {m.sources.map((s, sIdx) => (
                          <li key={s.id}>
                            <a
                              data-testid={`chat-source-${sIdx}`}
                              href={`/p/${s.id}`}
                              className="truncate text-blue-500 hover:underline dark:text-blue-400"
                            >
                              {s.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      data-testid="chat-action-copy"
                      onClick={() => copyText(m.content)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      title="Copy"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-feedback-up"
                      aria-pressed={feedback[m.id]?.vote === "up"}
                      onClick={() => handleVote(m.id, "up")}
                      className={`rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                        feedback[m.id]?.vote === "up"
                          ? "text-blue-500 dark:text-blue-400"
                          : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      }`}
                      title="Good response"
                    >
                      <ThumbsUp size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-feedback-down"
                      aria-pressed={feedback[m.id]?.vote === "down"}
                      onClick={() => handleVote(m.id, "down")}
                      className={`rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                        feedback[m.id]?.vote === "down"
                          ? "text-blue-500 dark:text-blue-400"
                          : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      }`}
                      title="Bad response"
                    >
                      <ThumbsDown size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-feedback-report"
                      onClick={() => handleReport(m.id)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      title="Report"
                    >
                      <Flag size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-quote-ask"
                      onClick={() => handleQuoteAsk(m.content)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      title="Quote and ask"
                    >
                      <Quote size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-action-insert"
                      onClick={() => createPageFromContent(m.content)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      title="Insert into page"
                    >
                      <FilePlus2 size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid="chat-action-newpage"
                      onClick={() => createPageFromContent(m.content)}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      title="Save as new page"
                    >
                      <Send size={13} />
                    </button>
                    {i === messages.length - 1 && (
                      <button
                        type="button"
                        data-testid="chat-regenerate"
                        onClick={() => void handleRegenerate()}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                        title="Regenerate"
                      >
                        <RefreshCw size={13} />
                      </button>
                    )}
                  </div>
                  <p
                    data-testid={`msg-time-${m.id}`}
                    title={new Date(m.createdAt).toLocaleString()}
                    className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500"
                  >
                    <span>{formatRelativeTime(m.createdAt)}</span>
                    <span
                      data-testid="msg-time-abs"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ({new Date(m.createdAt).toLocaleString()})
                    </span>
                  </p>
                </>
              )}
            </div>
          </div>
        ))}

        {streaming && (
          <div
            data-role="assistant"
            data-testid="chat-msg-assistant"
            className="flex justify-start"
          >
            <div className="max-w-[85%] rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
              <div data-testid="chat-msg-content">
                <MarkdownContent content={streamingText} />
              </div>
              <span
                data-testid="chat-streaming"
                className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500"
              >
                <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-current" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-neutral-200 p-3 dark:border-neutral-800">
        {usage && <UsageMeter usage={usage} onUpgrade={() => void handleUpgrade()} />}
        {isEditing && (
          <div
            data-testid="composer-editing"
            className="mb-2 flex items-center justify-between rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          >
            <span>Edit the message and send it again</span>
            <button
              type="button"
              data-testid="composer-editing-cancel"
              onClick={handleCancelEdit}
              className="rounded px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="relative mb-2 inline-block">
          <button
            type="button"
            data-testid="context-scope-btn"
            onClick={() => setScopeMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <span data-testid="context-scope-badge">
              {contextScope === "workspace" ? "Entire workspace" : "This page only"}
            </span>
          </button>
          {scopeMenuOpen && (
            <div
              data-testid="context-scope-menu"
              role="menu"
              className="absolute bottom-full left-0 z-30 mb-1 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            >
              <button
                type="button"
                data-testid="scope-workspace"
                role="menuitem"
                onClick={() => {
                  setContextScope("workspace");
                  setScopeMenuOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
              >
                Entire workspace
              </button>
              <button
                type="button"
                data-testid="scope-page"
                role="menuitem"
                onClick={() => {
                  setContextScope("page");
                  setScopeMenuOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
              >
                This page only
              </button>
            </div>
          )}
        </div>
        <MentionChips mentions={mention.mentions} onRemove={mention.removeMention} />
        <AttachmentsList
          attachments={attach.attachments}
          error={attach.error}
          onRemove={attach.removeAttachment}
        />
        <div className="relative flex items-end gap-2">
          <MentionDropdown
            open={mention.open}
            items={mention.items}
            selectedIndex={mention.selectedIndex}
            onPick={mention.pick}
            onHover={mention.setSelectedIndex}
          />
          <AttachButton
            onOpen={attach.openFilePicker}
            fileInputRef={attach.fileInputRef}
            onFileChange={attach.handleFileInputChange}
            disabled={composerDisabled}
          />
          <textarea
            ref={composerRef}
            data-testid="chat-composer-input"
            aria-label="Send a message to the workspace AI"
            value={input}
            onChange={(e) => mention.handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={attach.handlePaste}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder="Ask the workspace AI"
            rows={1}
            disabled={composerDisabled}
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:border-neutral-500"
          />
          {streaming ? (
            <button
              type="button"
              data-testid="chat-stop"
              onClick={handleStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600"
              aria-label="Stop"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="button"
              data-testid="chat-send"
              onClick={() => void handleSend()}
              disabled={
                !(input.trim() || attach.attachments.length > 0 || mention.mentions.length > 0) ||
                composerDisabled
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 px-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
          {input.length >= CHAR_WARN_THRESHOLD && (
            <span
              data-testid="composer-charwarn"
              className="font-medium text-amber-600 dark:text-amber-400"
            >
              Approaching the character limit
            </span>
          )}
          <span data-testid="composer-charcount">
            {input.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
