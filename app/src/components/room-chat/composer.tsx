"use client";

/** The room chat composer: one bordered container that grows to 8 lines, with
 *  its toolbar inside — attach and @ on the left, "Only the agent" and send on
 *  the right. "Only the agent" is the same private side-channel as the old
 *  lock toggle (the message POST's `quiet` flag); the parent owns the draft,
 *  the flag, uploads and sending, and this component only draws and routes
 *  keys. */
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { ArrowUp, AtSign, Lock, Paperclip, X } from "lucide-react";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { useT } from "@/i18n/provider";
import { MENTION_MENU_ID, MentionMenu, mentionOptionId } from "./mention-menu";
import type { RoomChatAttachment, RoomChatGuardNotice, RoomChatMention } from "./types";
import {
  ACCENT_BG,
  BORDER_STRONG,
  BUTTON_HOVER,
  PRESSED_BG,
  TEXT,
  TEXT_2,
  TEXT_3,
  YELLOW_CHIP,
} from "./tokens";

/** 8 lines of 22px plus the textarea's 13px vertical padding. */
const MAX_TEXTAREA_PX = 8 * 22 + 13;

const COARSE_POINTER_QUERY = "(pointer: coarse)";
function subscribeCoarsePointer(onChange: () => void): () => void {
  const mq = window.matchMedia(COARSE_POINTER_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** A touch-first device: its on-screen keyboard has no Shift, so Enter must
 *  add a line there and the round button sends. False on the server. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER_QUERY).matches,
    () => false
  );
}

export interface RoomChatComposerProps {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  roomName: string;
  draft: string;
  onDraftInput: (value: string) => void;
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

export function RoomChatComposer({
  composerRef,
  roomName,
  draft,
  onDraftInput,
  canAskPrivately,
  privateDraft,
  setPrivate,
  mention,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  uploading,
  sending,
  onSend,
  guardNotice,
  onSendAnyway,
}: RoomChatComposerProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const { imeProps, composing } = useImeGuard();
  const touch = useCoarsePointer();
  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !sending && !uploading;

  // autosize: shrink to content, cap at 8 lines (then it scrolls)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [draft, composerRef]);

  /** The @ button types an "@" at the caret, so the parent's own detection
   *  (it reads the caret) opens the menu exactly as typing it would. */
  function insertAt() {
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const start = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, start);
    const token = before && !/\s$/.test(before) ? " @" : "@";
    el.setRangeText(token, start, el.selectionEnd ?? start, "end");
    onDraftInput(el.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // the mention menu owns the arrows/Enter/Tab/Esc while it is open
    if (mention.open && mention.items.length) {
      const n = mention.items.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mention.setIndex((mention.index + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mention.setIndex((mention.index - 1 + n) % n);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !composing(e)) {
        e.preventDefault();
        mention.pick(mention.items[mention.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mention.close();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !touch && !composing(e)) {
      e.preventDefault();
      if (canSend) onSend();
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  }

  const scope = privateDraft
    ? t("Only you and the agent can see this · not added to the record")
    : canAskPrivately
      ? t("Shared with the room · the agent can add it to the record")
      : t("Shared with the room");

  return (
    <div className="shrink-0 pb-2.5 pt-1">
      {guardNotice && (
        <div
          data-testid="dm-guard-card"
          className="mb-2 space-y-1.5 rounded-md border border-[rgba(209,156,0,0.3)] bg-[rgba(209,156,0,0.08)] p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <div className="font-medium text-[rgb(106,66,34)] dark:text-amber-200">
            {t("⚠️ Conflicts with history")}
          </div>
          {guardNotice.reason && <p className={TEXT}>{guardNotice.reason}</p>}
          {guardNotice.evidence?.map((e, i) => (
            <p key={i} className={TEXT_2}>
              {t("Evidence [{section}] “{quote}”", { section: e.section, quote: e.quote })}
            </p>
          ))}
          {guardNotice.suggestion && (
            <p className={TEXT}>{t("Suggestion: {suggestion}", { suggestion: guardNotice.suggestion })}</p>
          )}
          <button
            type="button"
            data-testid="dm-guard-force"
            onClick={onSendAnyway}
            className={`rounded border px-2 py-0.5 text-[11px] ${BORDER_STRONG} ${TEXT_2} ${BUTTON_HOVER}`}
          >
            {t("Send anyway")}
          </button>
        </div>
      )}

      <div className="relative">
        <MentionMenu mention={mention} />
        <form
          data-testid="room-chat-composer"
          data-private={privateDraft ? "true" : "false"}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSend();
          }}
          className={`rounded-lg border shadow-[0_1px_2px_rgba(15,15,15,0.03)] transition-colors ${
            privateDraft
              ? "border-[rgba(209,156,0,0.3)] bg-[rgba(209,156,0,0.08)] dark:border-amber-500/30 dark:bg-amber-500/[0.08]"
              : `${BORDER_STRONG} bg-white focus-within:border-[rgba(55,53,47,0.28)] dark:bg-neutral-900 dark:focus-within:border-white/25`
          }`}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3.5 pt-3">
              {attachments.map((a) => (
                <span key={a.url} data-testid="dm-attachment-chip" className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="h-14 w-14 rounded-md object-cover" />
                  <button
                    type="button"
                    data-testid="dm-attachment-remove"
                    aria-label={t("Remove {name}", { name: a.name })}
                    onClick={() => onRemoveAttachment(a.url)}
                    // a 16px dot with a 40px hit area
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-white after:absolute after:-inset-3 after:content-[''] hover:bg-neutral-900"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={composerRef}
            data-testid="dm-composer-input"
            value={draft}
            rows={1}
            placeholder={
              privateDraft
                ? t("Ask the agent privately — others won't see it")
                : roomName
                  ? t("Message {name}", { name: roomName })
                  : t("Type a message…")
            }
            enterKeyHint={touch ? "enter" : "send"}
            aria-autocomplete="list"
            aria-controls={mention.open ? MENTION_MENU_ID : undefined}
            aria-activedescendant={
              mention.open && mention.items[mention.index] ? mentionOptionId(mention.items[mention.index]) : undefined
            }
            onChange={(e) => onDraftInput(e.target.value)}
            onKeyDown={onKeyDown}
            {...imeProps}
            className={`block w-full resize-none overflow-y-auto border-0 bg-transparent px-3.5 pb-0.5 pt-[11px] text-[14px] leading-[22px] outline-none placeholder:text-[#A19E99] dark:placeholder:text-neutral-500 ${TEXT}`}
            style={{ maxHeight: MAX_TEXTAREA_PX }}
          />

          <div className="flex items-center gap-0.5 pb-1.5 pl-2 pr-1.5 pt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-testid="dm-attach-input"
              onChange={(e) => {
                onAttachFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              data-testid="dm-attach"
              aria-label={t("Attach image")}
              data-tip={t("Attach photo")}
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={`flex h-7 w-7 items-center justify-center rounded disabled:opacity-50 pointer-coarse:h-9 pointer-coarse:w-9 ${TEXT_2} ${BUTTON_HOVER}`}
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              data-testid="room-chat-mention-button"
              aria-label={t("Mention someone")}
              data-tip={t("Mention someone")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertAt}
              className={`flex h-7 w-7 items-center justify-center rounded pointer-coarse:h-9 pointer-coarse:w-9 ${TEXT_2} ${BUTTON_HOVER} ${
                mention.open ? PRESSED_BG : ""
              }`}
            >
              <AtSign size={16} />
            </button>
            <span className="flex-1" />
            {canAskPrivately && (
              <button
                type="button"
                data-testid="dm-quiet-toggle"
                aria-pressed={privateDraft}
                onClick={() => {
                  setPrivate(!privateDraft);
                  composerRef.current?.focus();
                }}
                className={`mr-1 flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full pl-[7px] pr-[9px] text-[12.5px] font-medium pointer-coarse:h-9 ${
                  privateDraft ? YELLOW_CHIP : `${TEXT_2} ${BUTTON_HOVER}`
                }`}
              >
                <Lock size={14} />
                {t("Only the agent")}
              </button>
            )}
            <button
              type="submit"
              data-testid="dm-send"
              aria-label={t("Send message")}
              disabled={!canSend}
              // keep focus in the textarea, so a phone's keyboard stays up across sends
              onMouseDown={(e) => e.preventDefault()}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors pointer-coarse:h-9 pointer-coarse:w-9 ${
                hasContent ? `${ACCENT_BG} text-white hover:bg-[#0B6EC5]` : `${PRESSED_BG} ${TEXT_3}`
              } disabled:cursor-default ${hasContent && !canSend ? "opacity-60" : ""}`}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
      </div>

      <div className={`flex justify-between gap-3 px-1 pt-[5px] text-[11.5px] ${TEXT_3}`}>
        <span data-testid="room-chat-scope" className="min-w-0 truncate">
          {scope}
        </span>
        <span className="shrink-0 @max-md:hidden pointer-coarse:hidden">{t("Enter to send · Shift+Enter for a new line")}</span>
      </div>
    </div>
  );
}
