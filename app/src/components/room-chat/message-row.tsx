"use client";

/** One row of the room chat: flat and left-aligned for everyone. The first
 *  message of a group carries the avatar and "Name · 2:14 PM"; later ones show
 *  their time in the avatar column on hover or focus. The left gutter holds
 *  the record glyph (✦) or the private lock, and the top-right action bar
 *  ([✦ Ask the agent] | [⋯ Copy, Copy link]) appears on hover, keyboard focus,
 *  or a tap. Rows take part in the list's roving tabindex: only the `active`
 *  row is a Tab stop, and the list moves focus between rows with the arrows. */
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Link2, Lock, MoreHorizontal } from "lucide-react";
import type { DmUser } from "@/stores/dm-rooms";
import { useT } from "@/i18n/provider";
import { AgentMark, PersonAvatar } from "./avatar";
import { fullDateTime, gutterTime, headerTime, relativeTime, splitMentions } from "./timeline";
import type { RoomChatMessage } from "./types";
import {
  BUTTON_HOVER,
  GRAY_CHIP,
  MENTION,
  ORANGE_CHIP,
  POP_SHADOW,
  PRESSED_BG,
  ROW_HOVER,
  SURFACE,
  TEXT,
  TEXT_2,
  TEXT_3,
  TEXT_BODY,
} from "./tokens";

/** The list's scroll box; the ⋯ menu opens upward when it would be clipped there. */
const LIST_SELECTOR = '[data-testid="dm-messages"]';
/** Two 28px menu rows plus padding and gap. */
const MENU_HEIGHT_PX = 76;

/** A dark tooltip anchored to the left edge of its trigger. The global
 *  data-tip centres on the trigger, which the list's scroll box clips when the
 *  trigger sits in the gutter. It opens on hover, on focus inside the trigger,
 *  and — with `onRowFocus` — while the row itself has keyboard focus. */
function LeftTip({ tip, onRowFocus = false, children }: { tip: ReactNode; onRowFocus?: boolean; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded bg-[rgb(15,15,15)] px-2 py-1 text-[11.5px] font-normal leading-4 text-white group-focus-within/tip:block group-hover/tip:block ${
          onRowFocus ? "group-focus-visible/row:block" : ""
        }`}
      >
        {tip}
      </span>
    </span>
  );
}

/** Message text with @mentions of room members drawn as tinted pills; the
 *  rest goes through the parent's renderer (links, tx hashes, page links). */
function MessageText({
  text,
  handles,
  renderText,
}: {
  text: string;
  handles: ReadonlySet<string>;
  renderText: (text: string) => ReactNode;
}) {
  return splitMentions(text, handles).map((chunk, i) =>
    chunk.kind === "mention" ? (
      <span key={i} data-testid="room-chat-mention" className={MENTION}>
        {chunk.value}
      </span>
    ) : (
      <Fragment key={i}>{renderText(chunk.value)}</Fragment>
    )
  );
}

/** The ⋯ button and its menu (Copy, Copy link). Owns open state, outside
 *  dismissal, and arrow-key movement between its items. */
function MoreMenu({
  open,
  setOpen,
  onCopy,
  onCopyLink,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onCopy: () => void;
  onCopyLink: () => void;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);

  // opening: focus the first item; a pointer-down anywhere else closes it
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  function toggle() {
    if (!open) {
      const button = buttonRef.current;
      const list = button?.closest(LIST_SELECTOR);
      if (button && list) {
        const below = list.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom;
        setUp(below < MENU_HEIGHT_PX);
      }
    }
    setOpen(!open);
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  function run(action: () => void) {
    action();
    setOpen(false);
    buttonRef.current?.focus();
  }

  const item = `flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] ${TEXT_BODY} ${BUTTON_HOVER} focus-visible:outline-none focus-visible:bg-[rgba(55,53,47,0.06)] dark:focus-visible:bg-white/[0.06]`;

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        data-testid="room-chat-more"
        aria-label={t("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : t("More actions")}
        onClick={toggle}
        className={`flex h-[26px] w-7 items-center justify-center rounded pointer-coarse:h-9 pointer-coarse:w-9 ${
          open ? `${PRESSED_BG} ${TEXT}` : `${TEXT_2} ${BUTTON_HOVER}`
        }`}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("More actions")}
          data-testid="room-chat-more-menu"
          onKeyDown={onMenuKeyDown}
          className={`absolute right-0 z-30 w-[120px] rounded-md p-1 ${up ? "bottom-full mb-1" : "top-full mt-1"} ${SURFACE} ${POP_SHADOW}`}
        >
          <button type="button" role="menuitem" tabIndex={-1} data-testid="room-chat-copy" onClick={() => run(onCopy)} className={item}>
            <Copy size={16} aria-hidden className={TEXT_2} />
            {t("Copy")}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-testid="room-chat-copy-link"
            onClick={() => run(onCopyLink)}
            className={item}
          >
            <Link2 size={16} aria-hidden className={TEXT_2} />
            {t("Copy link")}
          </button>
        </div>
      )}
    </span>
  );
}

export function MessageRow({
  message,
  author,
  groupStart,
  privateStretchEnd,
  mine,
  active,
  highlighted,
  recordHref,
  canAskAgent,
  locale,
  now,
  mentionHandles,
  renderText,
  onFocusRow,
  onCopy,
  onCopyLink,
  onAskAgent,
}: {
  message: RoomChatMessage;
  author: DmUser | undefined;
  groupStart: boolean;
  /** last message of a private run — a narrow column explains the lock under it */
  privateStretchEnd: boolean;
  /** authored by the viewer — flat like everyone else's, only the test id differs */
  mine: boolean;
  /** the list's single Tab stop (roving tabindex) */
  active: boolean;
  /** briefly tinted when opened through a copied message link */
  highlighted: boolean;
  /** where "Open record" goes — the relation doc; null before one exists */
  recordHref: string | null;
  canAskAgent: boolean;
  locale: string;
  /** the list's clock (ms), ticking each minute, for "27 min ago" */
  now: number;
  /** lowercase "@" handles of the room's members, for mention pills */
  mentionHandles: ReadonlySet<string>;
  renderText: (text: string) => ReactNode;
  onFocusRow: (id: string) => void;
  onCopy: (message: RoomChatMessage) => void;
  onCopyLink: (message: RoomChatMessage) => void;
  onAskAgent: (message: RoomChatMessage) => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const isPrivate = Boolean(message.privateToUserId);
  const recorded = Boolean(message.recordedAt) && !isPrivate;
  const nowDate = new Date(now);
  const fullDate = fullDateTime(message.createdAt, locale, nowDate);
  const timeTip = (
    <>
      {relativeTime(message.createdAt, locale, nowDate)} <span className="text-white/60">· {fullDate}</span>
    </>
  );

  // gutter: the record glyph links to the record; the lock only explains
  const gutterMark = recorded ? (
    <LeftTip
      tip={
        <>
          {t("Added to the relation's record")} ·{" "}
          <span className="underline underline-offset-2">{t("Open record")}</span>
        </>
      }
    >
      {recordHref ? (
        <Link
          href={recordHref}
          tabIndex={active ? 0 : -1}
          data-testid="dm-msg-recorded"
          aria-label={t("Added to the relation's record · Open record")}
          className={`block w-[18px] text-center text-[11px] opacity-75 transition-colors hover:opacity-100 group-hover/row:opacity-100 ${TEXT_3} group-hover/row:text-[#7D7A75]`}
        >
          ✦
        </Link>
      ) : (
        <span
          role="img"
          data-testid="dm-msg-recorded"
          aria-label={t("Added to the relation's record")}
          className={`block w-[18px] text-center text-[11px] opacity-75 ${TEXT_3}`}
        >
          ✦
        </span>
      )}
    </LeftTip>
  ) : isPrivate ? (
    <LeftTip tip={t("Only you and the agent can see this · not added to the record")}>
      <span
        role="img"
        data-testid="room-chat-private-mark"
        aria-label={t("Only the agent")}
        className={`flex w-[18px] justify-center ${TEXT_3}`}
      >
        <Lock size={10} aria-hidden />
      </span>
    </LeftTip>
  ) : null;

  const barButton = `flex h-[26px] items-center justify-center rounded pointer-coarse:h-9 ${BUTTON_HOVER}`;

  return (
    <div
      id={`m-${message.id}`}
      data-testid={mine ? "dm-msg-mine" : "dm-msg-other"}
      data-room-chat-row=""
      data-group-start={groupStart ? "true" : "false"}
      tabIndex={active ? 0 : -1}
      onFocus={() => onFocusRow(message.id)}
      className={`group/row relative grid grid-cols-[18px_32px_minmax(0,1fr)] scroll-mt-12 rounded pr-3 text-[14px] outline-none transition-colors focus-visible:bg-[rgba(55,53,47,0.03)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2383E2]/50 ${ROW_HOVER} ${
        groupStart ? "mt-0.5 pb-0.5 pt-1" : "py-0.5"
      } ${highlighted ? "bg-[#2383E2]/[0.07]" : ""}`}
    >
      <div className={groupStart ? "leading-5" : "leading-[22px]"}>{gutterMark}</div>

      <div className="min-w-0">
        {groupStart ? (
          author?.isAgent ? (
            <AgentMark size={32} />
          ) : author ? (
            <PersonAvatar user={author} size={32} />
          ) : (
            <span className={`block h-8 w-8 rounded-full bg-[rgba(55,53,47,0.06)]`} />
          )
        ) : (
          <LeftTip tip={timeTip} onRowFocus>
            <time
              dateTime={message.createdAt}
              data-testid="room-chat-gutter-time"
              className={`block w-8 whitespace-nowrap text-right font-mono text-[10.5px] leading-[22px] opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 ${TEXT_3}`}
            >
              <span aria-hidden>{gutterTime(message.createdAt, locale)}</span>
              <span className="sr-only">{fullDate}</span>
            </time>
          </LeftTip>
        )}
      </div>

      <div className="min-w-0 pl-2.5">
        {groupStart && (
          <div className="flex h-5 min-w-0 items-center gap-2 leading-5">
            <span className={`truncate font-semibold ${TEXT}`} data-testid="room-chat-author">
              {author?.displayName ?? t("Unknown")}
            </span>
            {author?.isAgent && (
              <span
                data-testid="room-chat-agent-chip"
                className={`inline-flex h-[18px] shrink-0 items-center rounded-[3px] px-[5px] text-[11px] leading-none ${GRAY_CHIP}`}
              >
                {t("Agent")}
              </span>
            )}
            <LeftTip tip={timeTip} onRowFocus>
              <time dateTime={message.createdAt} className={`shrink-0 whitespace-nowrap text-xs ${TEXT_3}`}>
                <span aria-hidden>{headerTime(message.createdAt, locale)}</span>
                <span className="sr-only">{fullDate}</span>
              </time>
            </LeftTip>
            {isPrivate && (
              <span
                data-testid="dm-msg-private"
                className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[3px] px-[5px] text-[11px] leading-none ${ORANGE_CHIP}`}
              >
                <Lock size={9} aria-hidden />
                {/* a narrow column keeps the name readable: the note under the run explains it */}
                <span className="@max-md:sr-only">{t("Only the agent")}</span>
              </span>
            )}
          </div>
        )}

        {message.attachments?.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 pt-1 ${message.text ? "pb-1" : "pb-0.5"}`}>
            {message.attachments.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  data-testid="dm-msg-image"
                  src={a.url}
                  alt={a.name}
                  className="max-h-56 max-w-full rounded-md object-cover"
                />
              </a>
            ))}
          </div>
        )}

        {message.text && (
          <p
            data-testid="dm-msg-text"
            className={`whitespace-pre-wrap text-[14px] leading-[22px] [overflow-wrap:anywhere] ${TEXT}`}
          >
            <MessageText text={message.text} handles={mentionHandles} renderText={renderText} />
          </p>
        )}

        {/* the chip's label is hidden in a narrow column (phones, the call panel),
            so the run itself says what the lock means — tooltips never open on touch */}
        {isPrivate && privateStretchEnd && (
          <p
            data-testid="room-chat-private-note"
            className={`hidden items-center gap-1 pt-0.5 text-[11.5px] leading-4 @max-md:flex ${TEXT_3}`}
          >
            <Lock size={10} aria-hidden className="shrink-0" />
            {t("Only you and the agent can see this · not added to the record")}
          </p>
        )}
      </div>

      {/* Hover / focus action bar, the mockup's [✦ Ask the agent] | [⋯]. Only
          actions the backend already has: copying is local, and "Ask the
          agent" is the private side-channel. Reactions, replies and delete
          have no API, so they are left out. */}
      <div
        role="toolbar"
        aria-label={t("Message actions")}
        data-testid="room-chat-actions"
        className={`absolute -top-3.5 right-2.5 z-10 items-center gap-px rounded-md p-0.5 pointer-coarse:-top-5 ${
          menuOpen ? "flex" : "hidden group-focus-within/row:flex group-hover/row:flex"
        } ${SURFACE} ${POP_SHADOW}`}
      >
        {canAskAgent && (
          <>
            <button
              type="button"
              data-testid="room-chat-ask-agent"
              onClick={() => onAskAgent(message)}
              className={`${barButton} gap-1.5 whitespace-nowrap px-2 text-[12.5px] font-medium ${TEXT_BODY}`}
            >
              <span aria-hidden>✦</span>
              {t("Ask the agent")}
            </button>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-[rgba(55,53,47,0.16)] dark:bg-white/15" />
          </>
        )}
        <MoreMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          onCopy={() => onCopy(message)}
          onCopyLink={() => onCopyLink(message)}
        />
      </div>
    </div>
  );
}
