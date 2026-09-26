"use client";

/** The composer's "@" menu: the agent first, then the members. Detection,
 *  keyboard movement and insertion belong to the parent (dm-view's
 *  onInputChange / pickMention); this only draws `mention.items` in order.
 *  The textarea points at the active option with aria-activedescendant
 *  (mentionOptionId), so arrow keys are announced without moving focus. */
import type { DmUser } from "@/stores/dm-rooms";
import { useT } from "@/i18n/provider";
import { AgentMark, PersonAvatar } from "./avatar";
import { mentionHandle } from "./timeline";
import type { RoomChatMention } from "./types";
import { BORDER, GRAY_CHIP, POP_SHADOW, PRESSED_BG, SURFACE, TEXT, TEXT_2, TEXT_3 } from "./tokens";

export const MENTION_MENU_ID = "room-chat-mention-menu";
export function mentionOptionId(user: DmUser): string {
  return `room-chat-mention-${user.id}`;
}

export function MentionMenu({ mention }: { mention: RoomChatMention }) {
  const t = useT();
  if (!mention.open || mention.items.length === 0) return null;

  // consecutive runs of agent / member rows, each drawn as one labelled group
  const sections: { agent: boolean; rows: { user: DmUser; index: number }[] }[] = [];
  mention.items.forEach((user, index) => {
    const last = sections[sections.length - 1];
    if (last && last.agent === Boolean(user.isAgent)) last.rows.push({ user, index });
    else sections.push({ agent: Boolean(user.isAgent), rows: [{ user, index }] });
  });

  return (
    <div
      id={MENTION_MENU_ID}
      data-testid="dm-mention-menu"
      role="listbox"
      aria-label={t("Mention someone")}
      className={`absolute bottom-full left-0 z-30 mb-2 w-72 max-w-full rounded-md p-1 ${SURFACE} ${POP_SHADOW}`}
    >
      {sections.map((section, s) => {
        const labelId = `${MENTION_MENU_ID}-group-${s}`;
        return (
          <div key={labelId} role="group" aria-labelledby={labelId}>
            <div id={labelId} className={`px-2 pb-1 pt-1.5 text-[11.5px] font-medium ${TEXT_2}`}>
              {section.agent ? t("Agent") : t("Members")}
            </div>
            {section.rows.map(({ user: u, index: i }) => (
              <button
                key={u.id}
                id={mentionOptionId(u)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === mention.index}
                data-testid={`dm-mention-item-${u.id}`}
                onMouseEnter={() => mention.setIndex(i)}
                // mousedown, not click: a click would blur the textarea first and lose the caret
                onMouseDown={(e) => {
                  e.preventDefault();
                  mention.pick(u);
                }}
                className={`flex min-h-[34px] w-full items-center gap-2.5 rounded px-2 py-1 text-left text-sm ${TEXT} ${
                  i === mention.index ? PRESSED_BG : ""
                }`}
              >
                {u.isAgent ? <AgentMark size={24} /> : <PersonAvatar user={u} size={24} />}
                {u.isAgent ? (
                  // the one on-screen cue that @agent answers in the room, unlike "Only the agent"
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate">{u.displayName}</span>
                      <span
                        className={`ml-auto inline-flex h-[18px] shrink-0 items-center rounded-[3px] px-[5px] text-[11px] leading-none ${GRAY_CHIP}`}
                      >
                        {t("Agent")}
                      </span>
                    </span>
                    <span className={`block truncate text-[11.5px] leading-4 ${TEXT_3}`}>
                      @{mentionHandle(u)} · {t("Ask in the room — answers are based on your records")}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                    <span className={`ml-auto shrink-0 text-xs ${TEXT_3}`}>@{mentionHandle(u)}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        );
      })}
      <div className={`mt-1 border-t px-2 pb-0.5 pt-1.5 text-[11.5px] pointer-coarse:hidden ${BORDER} ${TEXT_3}`}>
        {t("↑↓ to move · Enter to select · Esc to close")}
      </div>
    </div>
  );
}
