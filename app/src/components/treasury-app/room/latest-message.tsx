"use client";

/**
 * The room's latest message, as a card beside the Treasury's content, so the
 * conversation stays one tap away while people look at money; tapping it
 * opens the room. Reads the same GET /api/dm/rooms/[roomId]/messages the room
 * chat loads (members only, private exchanges only for their asker) and shows
 * the newest message everyone can see. Until there is one, it shows nothing.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { useIntlLocale, useT } from "@/i18n/provider";
import { stripA2uiMarkers } from "@/lib/agent/treasurer/surfaces";
import { timeOnly } from "./room-model";
import type { TreasuryRoomPerson } from "./room-types";
import styles from "./treasury-room.module.css";

const POLL_MS = 8000;

interface RoomMessage {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  privateToUserId: string | null;
  attachments?: { name: string }[];
}

function preview(m: RoomMessage): string {
  // a card marker line renders as a card in the room, not as text
  const text = stripA2uiMarkers(m.text).replace(/\s+/g, " ").trim();
  if (text) return text;
  return m.attachments?.length ? m.attachments.map((a) => a.name).join(", ") : "";
}

function useLatestMessage(roomId: string): RoomMessage | null {
  const [latest, setLatest] = useState<RoomMessage | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/dm/rooms/${encodeURIComponent(roomId)}/messages`, { cache: "no-store" });
        if (!res.ok) return;
        const { messages } = (await res.json()) as { messages: RoomMessage[] };
        const shared = messages.filter((m) => m.privateToUserId === null && preview(m));
        if (alive) setLatest(shared[shared.length - 1] ?? null);
      } catch {
        // a convenience: a failed poll keeps the last message
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

export function LatestMessage({ roomId, members, meId }: { roomId: string; members: TreasuryRoomPerson[]; meId: string }) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const latest = useLatestMessage(roomId);
  if (!latest) return null;

  const author = members.find((m) => m.id === latest.authorId);
  const name = latest.authorId === meId ? t("You") : (author?.displayName ?? t("Someone"));
  return (
    <Link href={`/dm/${encodeURIComponent(roomId)}`} className={`${styles.card} ${styles.latest}`} data-testid="treasury-room-latest">
      <span className={styles.latestIcon} aria-hidden>
        {author?.avatarUrl ? <img src={author.avatarUrl} alt="" className={styles.latestAvatar} /> : <MessageCircle size={16} />}
      </span>
      <span className={styles.latestText}>
        <span className={styles.latestMeta}>
          <strong>{name}</strong>
          <span className={styles.num}>{timeOnly(latest.createdAt, intlLocale)}</span>
        </span>
        <span className={styles.latestLine}>{preview(latest)}</span>
      </span>
      <ChevronRight size={16} aria-hidden className={styles.latestChevron} />
    </Link>
  );
}
