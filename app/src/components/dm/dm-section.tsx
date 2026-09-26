"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { dmRoomLabel, useDmRoomsStore, type DmRoomSummary } from "@/stores/dm-rooms";
import { DmAvatar } from "./dm-avatar";
import { RelationshipsStrip } from "./relationships-strip";
import { NewDmModal } from "./new-dm-modal";
import type { T } from "@/i18n/translate";
import { useIntlLocale, useT } from "@/i18n/provider";
import { chipColors } from "@/components/database/option-chip";
import { useTreasuryV2 } from "@/components/treasury-app/use-treasury-ui";
import { useTreasurySummary, type TreasurySummaryRoom } from "@/components/sidebar/use-treasury-summary";

function preview(room: DmRoomSummary, t: T): string {
  const m = room.lastMessage;
  if (!m) return t("Start a chat");
  // one line: a multi-line message ("I won't do that.\nOur rules say…") reads
  // as sentences, not glued together where the line break was
  if (m.text) return m.text.replace(/\s*\n\s*/g, " ");
  if (m.hasAttachments) return t("📷 Photo");
  return "";
}

/** "Mon 9/28" — the mockup's short form in every locale (Intl's own short form changes order and punctuation per locale). */
function weekdayMonthDay(d: Date, locale: string): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(d);
  return `${weekday} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * A relation row's money line, as in the placement mockup's sidebar: ONE state,
 * by priority — my vote is owed (orange) › a recurring buy is running (green,
 * then when it next buys) › nothing (no line at all).
 */
function MoneyLine({ money }: { money: TreasurySummaryRoom | undefined }) {
  const t = useT();
  const locale = useIntlLocale();
  if (!money) return null;
  const usd = (n: number) => `$${n.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  const live = money.recurring?.state === "live" ? money.recurring : null;
  let chip: { color: "orange" | "green"; label: string; dot: boolean } | null = null;
  let detail: string | null = null;
  if (money.pendingForMe > 0) {
    chip = { color: "orange", dot: true, label: t("{n} waiting for your approval", { n: money.pendingForMe }) };
  } else if (live) {
    chip = { color: "green", dot: false, label: t("Buying {amount} weekly", { amount: `${live.weeklyUsd} USDC` }) };
    detail = live.boughtThisWeek
      ? t("Bought this week")
      : live.nextRunAt
        ? t("Next {date}", { date: weekdayMonthDay(new Date(live.nextRunAt), locale) })
        : null;
  }
  if (!chip) return null;
  const c = chipColors(chip.color);
  return (
    <span
      data-testid={`dm-money-${money.roomId}`}
      className="mt-[5px] flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-neutral-400 dark:text-neutral-500"
    >
      {money.balanceUsd !== null && (
        <>
          <span className="tabular-nums">{usd(money.balanceUsd)}</span>
          <span>·</span>
        </>
      )}
      <span
        className={`inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded-[4px] px-1.5 leading-none ${
          chip.color === "orange" ? "font-medium" : ""
        }`}
        style={{ background: c.bg, color: c.text }}
      >
        {chip.dot && <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.dot }} />}
        {chip.label}
      </span>
      {detail && <span className="tabular-nums">{detail}</span>}
    </span>
  );
}

/** Sidebar Chats tab, "Relationships" section — sits above the AI chat list. */
export function DmSection() {
  const router = useRouter();
  const rooms = useDmRoomsStore((s) => s.rooms);
  const loaded = useDmRoomsStore((s) => s.loaded);
  const load = useDmRoomsStore((s) => s.load);
  const markReadLocal = useDmRoomsStore((s) => s.markReadLocal);
  const [meId, setMeId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const t = useT();
  const money = useTreasurySummary(useTreasuryV2());

  useEffect(() => {
    void load();
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => alive && setMeId(d?.user?.id ?? null));
    return () => {
      alive = false;
    };
  }, [load]);

  function openRoom(id: string) {
    markReadLocal(id);
    router.push(`/dm/${id}`);
  }

  return (
    <div data-testid="dm-section" className="pb-2">
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {t("Relation")}
        </h3>
        <button
          data-testid="dm-new"
          onClick={() => setShowModal(true)}
          aria-label={t("New relation")}
          data-tip={t("New relation")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-neutral-200/70 hover:text-neutral-700 active:scale-90 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={17} strokeWidth={2.2} />
        </button>
      </div>

      {/* face strip and room list share this section's one header */}
      <RelationshipsStrip />

      {!loaded ? (
        <div className="space-y-1.5 px-2 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <button
          data-testid="dms-empty"
          onClick={() => setShowModal(true)}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <Plus size={14} className="shrink-0" />
          {t("Send your first message")}
        </button>
      ) : (
        rooms.map((room) => {
          const others = room.members.filter((m) => m.id !== meId);
          // a human fronts the row; the agent still counts as a member below
          const face = others.find((m) => !m.isAgent) ?? others[0] ?? room.members[0];
          return (
            <div
              key={room.id}
              data-testid={`dm-item-${room.id}`}
              className="group/dm relative mx-1 flex items-center rounded-md transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800/70"
            >
              <button
                data-testid={`dm-open-${room.id}`}
                onClick={() => openRoom(room.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
              >
                <span className="relative shrink-0">
                  {face && <DmAvatar user={face} size={28} />}
                  {room.members.length > 2 && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-500 px-0.5 text-[9px] font-semibold text-white ring-2 ring-white dark:bg-neutral-500 dark:ring-neutral-900">
                      {room.members.length}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span
                    className={`block truncate text-[13px] ${
                      room.unreadCount > 0
                        ? "font-semibold text-neutral-900 dark:text-neutral-50"
                        : "font-medium text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {dmRoomLabel(room, meId)}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11px] ${
                      room.unreadCount > 0
                        ? "text-neutral-500 dark:text-neutral-300"
                        : "text-neutral-400 dark:text-neutral-500"
                    }`}
                  >
                    {preview(room, t)}
                  </span>
                  <MoneyLine money={money.get(room.id)} />
                </span>
                {room.unreadCount > 0 && (
                  <span
                    data-testid={`dm-unread-${room.id}`}
                    aria-label={t("{n} unread", { n: room.unreadCount })}
                    className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-semibold tabular-nums text-white shadow-sm"
                  >
                    {room.unreadCount > 99 ? "99+" : room.unreadCount}
                  </span>
                )}
              </button>
            </div>
          );
        })
      )}

      {showModal && <NewDmModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
