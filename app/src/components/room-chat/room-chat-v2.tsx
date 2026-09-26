"use client";

/** Room chat v2 — the Notion-style message column and composer for a DM room.
 *
 *  A presentation layer over the state dm-view.tsx already keeps: it takes the
 *  same messages, users and callbacks the v1 list and composer use, and adds
 *  nothing on the server. What it owns is view state only: grouping, dividers,
 *  "stick to the bottom unless you scrolled up", the jump-to-latest pill, the
 *  message-link highlight, the unread divider's anchor (read once from the
 *  sidebar store's unread count when the room opens), the rows' roving
 *  tabindex, and a screen-reader announcer for arriving messages.
 *
 *  Narrow layouts key off the column (`@container`), not the viewport, so the
 *  in-call side panel gets the phone layout on a desktop screen; touch sizing
 *  keys off `pointer-coarse`. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowDown } from "lucide-react";
import { useDmRoomsStore, type DmUser } from "@/stores/dm-rooms";
import { useToastStore } from "@/stores/toast";
import { useIntlLocale, useT } from "@/i18n/provider";
import { RoomChatComposer } from "./composer";
import { MessageRow } from "./message-row";
import { buildTimeline, dividerDate, firstUnreadMessageId, mentionHandle, quoteForAgent } from "./timeline";
import type { RoomChatAttachment, RoomChatGuardNotice, RoomChatMention, RoomChatMessage } from "./types";
import { POP_SHADOW, SURFACE, TEXT_2, TEXT_3, TEXT_BODY } from "./tokens";

/** Within this many px of the bottom counts as "reading the latest". */
const STICK_THRESHOLD_PX = 48;
/** How long a message opened through a copied link stays tinted. */
const LINK_HIGHLIGHT_MS = 2_500;
/** How often "27 min ago" in the time tooltips is recomputed. */
const CLOCK_TICK_MS = 60_000;
/** Arriving messages kept in the screen-reader announcer. */
const ANNOUNCE_KEEP = 5;
const ROW_SELECTOR = "[data-room-chat-row]";
/** The typing dots' blink; hoisted and deduplicated by React. */
const TYPING_KEYFRAMES = "@keyframes room-chat-blink{0%,60%,100%{opacity:.3}30%{opacity:1}}";

export interface RoomChatV2Props {
  roomId: string;
  /** the room title — the placeholder reads "Message {roomName}" */
  roomName: string;
  meId: string | null;
  messages: RoomChatMessage[];
  userById: Map<string, DmUser>;
  loading: boolean;
  /** the relation doc ("Open record"); null before the agent has made one */
  recordHref: string | null;
  /** renders a message's text — links, tx hashes, /p/ page links, and the
   *  [[a2ui:...]] card line once that renderer exists */
  renderText: (text: string) => ReactNode;
  typingNames?: string[];

  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  /** a keystroke in the composer (mention detection + typing ping) */
  onDraftInput: (value: string) => void;
  /** replace the draft without a keystroke (the "Ask the agent" prefill) */
  setDraft: (value: string) => void;
  /** the room has a relation agent, so the private side-channel exists */
  canAskPrivately: boolean;
  privateDraft: boolean;
  setPrivate: (on: boolean) => void;
  mention: RoomChatMention;
  attachments: RoomChatAttachment[];
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (url: string) => void;
  uploading: boolean;
  sending: boolean;
  onSend: () => void;
  guardNotice: RoomChatGuardNotice | null;
  onSendAnyway: () => void;
}

/** The first unread message when this room opened, frozen for the visit: the
 *  divider must not jump as the read POST clears the sidebar count. */
function useUnreadAnchor(
  roomId: string,
  meId: string | null,
  messages: RoomChatMessage[],
  loading: boolean
): string | null {
  const unreadCount = useDmRoomsStore((s) => s.rooms.find((r) => r.id === roomId)?.unreadCount ?? 0);
  const [anchor, setAnchor] = useState<{ roomId: string; id: string | null } | null>(null);
  const ready = !loading && messages.length > 0 && meId !== null;
  // derived-state-on-render: set once per room, the first render the list is there
  if (ready && anchor?.roomId !== roomId) {
    setAnchor({ roomId, id: firstUnreadMessageId(messages, meId, unreadCount) });
  }
  return anchor?.roomId === roomId ? anchor.id : null;
}

/** Wall-clock ms, refreshed every CLOCK_TICK_MS — relative times stay current
 *  without calling Date.now() during render. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function RoomChatV2(props: RoomChatV2Props) {
  const {
    roomId,
    meId,
    messages,
    userById,
    loading,
    recordHref,
    renderText,
    typingNames = [],
    composerRef,
    draft,
    setDraft,
    canAskPrivately,
    setPrivate,
    mention,
  } = props;
  const t = useT();
  const locale = useIntlLocale();
  const show = useToastStore((s) => s.show);
  const now = useMinuteClock();

  // the handles "@" inserts, so mentions in message text can be drawn as pills
  const mentionHandles = useMemo(
    () => new Set([...userById.values()].map((u) => mentionHandle(u).toLowerCase())),
    [userById]
  );

  const firstUnreadId = useUnreadAnchor(roomId, meId, messages, loading);
  const timeline = useMemo(() => buildTimeline(messages, firstUnreadId), [messages, firstUnreadId]);

  // ── scrolling: follow the bottom unless the reader scrolled up ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [missed, setMissed] = useState(0); // others' messages that arrived while scrolled up
  const seenCountRef = useRef(0); // messages.length at the last layout pass
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [announced, setAnnounced] = useState<{ id: string; text: string }[]>([]);

  // roving tabindex: one row is the list's Tab stop — the last focused, else the newest
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const activeRowId =
    focusedRowId && messages.some((m) => m.id === focusedRowId)
      ? focusedRowId
      : (messages[messages.length - 1]?.id ?? null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    atBottomRef.current = atBottom;
    setScrolledUp(!atBottom);
    if (atBottom) setMissed(0);
  }

  // new messages: follow if at the bottom or if I sent it; otherwise count it for the pill
  useLayoutEffect(() => {
    const prevCount = seenCountRef.current;
    seenCountRef.current = messages.length;
    if (messages.length === 0) return;

    // first paint of the room: a copied message link wins over the bottom
    if (prevCount === 0) {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const target = hash.startsWith("#m-") ? document.getElementById(hash.slice(1)) : null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        atBottomRef.current = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot on first paint
        setHighlightId(hash.slice(3));
      } else {
        scrollToBottom();
      }
      return;
    }
    if (messages.length <= prevCount) return;
    const added = messages.slice(prevCount);
    const mineAdded = added.some((m) => m.authorId === meId);
    const othersAdded = added.filter((m) => m.authorId !== meId);
    if (othersAdded.length > 0) {
      setAnnounced((prev) =>
        [
          ...prev,
          ...othersAdded.map((m) => ({
            id: m.id,
            text: `${userById.get(m.authorId)?.displayName ?? t("Unknown")}: ${m.text || m.attachments.map((a) => a.name).join(", ")}`,
          })),
        ].slice(-ANNOUNCE_KEEP)
      );
    }
    if (atBottomRef.current || mineAdded) {
      scrollToBottom();
      setMissed(0);
    } else {
      setMissed((n) => n + othersAdded.length);
    }
  }, [messages, meId, scrollToBottom, userById, t]);

  // keep the bottom pinned if we were there: the content grows (typing line,
  // images loading) or the scroll box shrinks (composer growing, attachment
  // strip or guard card appearing, the on-screen keyboard, rotation)
  useEffect(() => {
    const content = contentRef.current;
    const box = scrollRef.current;
    if (!content || !box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) scrollToBottom();
    });
    ro.observe(content);
    ro.observe(box);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), LINK_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // ── row actions ──
  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      show(done);
    } catch {
      show(t("Couldn't copy"));
    }
  }

  function onCopy(m: RoomChatMessage) {
    const text = m.text || m.attachments.map((a) => a.url).join("\n");
    void copyText(text, t("Copied"));
  }

  function onCopyLink(m: RoomChatMessage) {
    void copyText(`${window.location.origin}/dm/${roomId}#m-${m.id}`, t("Link copied"));
  }

  /** Open the private side-channel with this message quoted, caret after the quote. */
  function onAskAgent(m: RoomChatMessage) {
    // an open "@" menu holds a start offset into the old draft; picking from it
    // after the quote is prepended would splice the quote away
    mention.close();
    const source = m.text || m.attachments.map((a) => a.name).join(", ");
    const quote = quoteForAgent(source);
    setPrivate(true);
    setDraft(`${quote}${draft}`);
    // focus inside the tap itself — iOS only raises the keyboard for that;
    // the caret waits for the new draft to render
    composerRef.current?.focus();
    requestAnimationFrame(() => composerRef.current?.setSelectionRange(quote.length, quote.length));
  }

  /** ↑/↓ move between rows, Home/End jump to the ends (roving tabindex). */
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const row = e.target as HTMLElement;
    if (!row.matches(ROW_SELECTOR)) return;
    const rows = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []);
    const at = rows.indexOf(row);
    const next =
      e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : -1;
    if (next < 0 || next >= rows.length || next === at) return;
    e.preventDefault();
    rows[next].focus();
  }

  const typingLabel = t("{names} typing…").split("{names}");

  return (
    <div data-testid="room-chat-v2" className="@container relative flex min-h-0 flex-1 flex-col">
      {/* Arriving messages for screen readers. The list itself is not a live
          region: its rows reveal toolbars and tooltips on hover and focus,
          which a live region would read out as additions. */}
      <div role="log" aria-live="polite" className="sr-only" data-testid="room-chat-announcer">
        {announced.map((a) => (
          <p key={a.id}>{a.text}</p>
        ))}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="dm-messages"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {/* arrow keys arrive here from the focused row (roving tabindex) */}
        <div ref={contentRef} onKeyDown={onListKeyDown} className="flex min-h-full flex-col justify-end pb-1.5 pt-5">
          {loading ? (
            <div className="space-y-3 px-[18px]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[rgba(55,53,47,0.06)] dark:bg-white/[0.06]" />
                  <span className="h-5 w-2/3 animate-pulse rounded bg-[rgba(55,53,47,0.06)] dark:bg-white/[0.06]" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className={`py-10 text-center text-sm ${TEXT_3}`} data-testid="dm-empty">
              {t("No messages yet — say hello 👋")}
            </p>
          ) : (
            timeline.map((item) => {
              if (item.kind === "date") {
                return (
                  <div
                    key={item.key}
                    data-testid="room-chat-date"
                    className={`mb-0.5 mt-2 flex items-center gap-3 text-xs font-medium ${TEXT_2} before:h-px before:flex-1 before:bg-[rgba(55,53,47,0.09)] after:h-px after:flex-1 after:bg-[rgba(55,53,47,0.09)] dark:before:bg-white/10 dark:after:bg-white/10`}
                  >
                    {dividerDate(item.iso, locale)}
                  </div>
                );
              }
              if (item.kind === "unread") {
                return (
                  <div
                    key={item.key}
                    data-testid="room-chat-new-divider"
                    className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-[#E03E3E] before:h-px before:flex-1 before:bg-[#E03E3E] before:opacity-80"
                  >
                    {t("New messages")}
                  </div>
                );
              }
              return (
                <MessageRow
                  key={item.key}
                  message={item.message}
                  author={userById.get(item.message.authorId)}
                  groupStart={item.groupStart}
                  privateStretchEnd={item.privateStretchEnd}
                  mine={item.message.authorId === meId}
                  active={item.message.id === activeRowId}
                  highlighted={highlightId === item.message.id}
                  recordHref={recordHref}
                  canAskAgent={canAskPrivately}
                  locale={locale}
                  now={now}
                  mentionHandles={mentionHandles}
                  renderText={renderText}
                  onFocusRow={setFocusedRowId}
                  onCopy={onCopy}
                  onCopyLink={onCopyLink}
                  onAskAgent={onAskAgent}
                />
              );
            })
          )}

          {typingNames.length > 0 && (
            <div data-testid="dm-typing" className={`flex h-[22px] items-center gap-2 pl-7 pt-1 text-xs ${TEXT_2}`}>
              <style href="room-chat-blink" precedence="default">
                {TYPING_KEYFRAMES}
              </style>
              <span className="flex gap-[3px]" aria-hidden>
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-1 w-1 animate-[room-chat-blink_1.2s_infinite] rounded-full bg-[#A19E99] motion-reduce:animate-none"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </span>
              <span>
                {typingLabel[0]}
                <b className={`font-medium ${TEXT_BODY}`}>{typingNames.join(", ")}</b>
                {typingLabel.slice(1).join("")}
              </span>
            </div>
          )}
        </div>
      </div>

      {scrolledUp && (
        <div className="pointer-events-none relative h-0">
          {/* fades the last visible lines under the pill */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[70px] bg-linear-to-b from-white/0 to-white to-70% dark:from-neutral-900/0 dark:to-neutral-900"
          />
          <button
            type="button"
            data-testid="room-chat-jump-latest"
            onClick={() => {
              scrollToBottom(true);
              setMissed(0);
            }}
            className={`pointer-events-auto absolute bottom-[22px] left-1/2 flex h-[30px] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full pl-2.5 pr-3 text-[12.5px] font-medium ${SURFACE} ${POP_SHADOW} ${TEXT_BODY}`}
          >
            <ArrowDown size={14} />
            {t("Latest messages")}
            {missed > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-lg bg-[#2383E2] px-[5px] font-mono text-[11px] text-white">
                {missed}
              </span>
            )}
          </button>
        </div>
      )}

      <RoomChatComposer
          composerRef={composerRef}
          roomName={loading ? "" : props.roomName}
          draft={draft}
          onDraftInput={props.onDraftInput}
          canAskPrivately={canAskPrivately}
          privateDraft={props.privateDraft}
          setPrivate={setPrivate}
          mention={mention}
          attachments={props.attachments}
          onAttachFiles={props.onAttachFiles}
          onRemoveAttachment={props.onRemoveAttachment}
          uploading={props.uploading}
          sending={props.sending}
          onSend={props.onSend}
          guardNotice={props.guardNotice}
          onSendAnyway={props.onSendAnyway}
        />
    </div>
  );
}
