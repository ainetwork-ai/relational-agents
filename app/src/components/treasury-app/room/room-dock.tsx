"use client";

/**
 * A small dock at the bottom of the Treasury page with the room's latest
 * message, so the conversation stays in view while people look at money.
 * Reads the same GET /api/dm/rooms/[roomId]/messages the room chat loads
 * (members only, private exchanges only for their asker) and shows the newest
 * message everyone can see; tapping it opens the room.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, X } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import { stripA2uiMarkers } from "@/lib/agent/treasurer/surfaces";
import { timeOnly } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";

const POLL_MS = 8000;

interface DockMessage {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  privateToUserId: string | null;
  attachments?: { name: string }[];
}

function preview(m: DockMessage): string {
  // a card marker line renders as a card in the room, not as text
  const text = stripA2uiMarkers(m.text).replace(/\s+/g, " ").trim();
  if (text) return text;
  return m.attachments?.length ? m.attachments.map((a) => a.name).join(", ") : "";
}

function useLatestMessage(roomId: string): DockMessage | null {
  const [latest, setLatest] = useState<DockMessage | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/dm/rooms/${encodeURIComponent(roomId)}/messages`, { cache: "no-store" });
        if (!res.ok) return;
        const { messages } = (await res.json()) as { messages: DockMessage[] };
        const shared = messages.filter((m) => m.privateToUserId === null && preview(m));
        if (alive) setLatest(shared[shared.length - 1] ?? null);
      } catch {
        // the dock is a convenience; a failed poll keeps the last message
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [roomId]);
  return latest;
}

export function RoomDock({ roomId, members, meId }: { roomId: string; members: TreasuryRoomPerson[]; meId: string }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const latest = useLatestMessage(roomId);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  if (!latest || hiddenId === latest.id) return null;

  const author = members.find((m) => m.id === latest.authorId);
  const name = latest.authorId === meId ? t("You") : (author?.displayName ?? t("Someone"));
  return (
    <div className={styles.dock} data-testid="treasury-room-dock">
      <Link href={`/dm/${encodeURIComponent(roomId)}`} className={styles.dockLink}>
        <span className={styles.dockIcon} aria-hidden>
          {author?.avatarUrl ? <img src={author.avatarUrl} alt="" className={styles.dockAvatar} /> : <MessageCircle size={16} />}
        </span>
        <span className={styles.dockText}>
          <span className={styles.dockMeta}>
            <strong>{name}</strong>
            <span className={styles.num}>{timeOnly(latest.createdAt, intlLocale)}</span>
          </span>
          <span className={styles.dockLine}>{preview(latest)}</span>
        </span>
      </Link>
      <button type="button" className={styles.dockClose} onClick={() => setHiddenId(latest.id)} aria-label={t("Hide the latest message")}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
