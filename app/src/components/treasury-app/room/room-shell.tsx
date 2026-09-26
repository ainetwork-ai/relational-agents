"use client";

/**
 * The frame every /treasury/[roomId] tab renders in: the way back to the
 * room's chat and to the relation's doc, the "Treasury" crumb to every
 * relation's treasury, the room's name, the tabs (Wallet first), the World ID
 * outcome banner, and the column beside the content — the treasurer chat on
 * the Treasurer tab (its one home), elsewhere a compact entry to it and the
 * room's latest message.
 * Its look is the Treasury product's own (coral, Pretendard), scoped under one
 * CSS-module root so nothing reaches the Notion app around it. Like the
 * overview, it renders only when the per-browser Treasury switch is on.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { countedLine, isResultCode, resultCopy, type ResultCopy } from "@/components/treasury/world-result-copy";
import { ToneIcon } from "@/components/treasury/tone-icon";
import { TreasurerChat } from "@/components/treasurer/treasurer-chat";
import { TreasuryRoomProvider, useTreasuryRoom, type RoomLoad } from "./room-data";
import { LatestMessage } from "./latest-message";
import { treasuryPath } from "./room-model";
import { TreasurerEntry } from "./treasurer-entry";
import styles from "./treasury-room.module.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

type Tab = { href: string; label: string; exact: boolean };

/**
 * What the World ID callback reports on ?treasury= (callback/route.ts) — the
 * room panel's table, so a code reads the same on both. A code the table
 * doesn't know shows nothing: the query string is anyone's to write.
 */
function resultLine(t: T, code: string): ResultCopy | null {
  const copy = resultCopy("treasury", code);
  return copy && { tone: copy.tone, text: t(copy.text) };
}

function useCallbackResult(): [string | null, () => void] {
  const params = useSearchParams();
  const [code, setCode] = useState<string | null>(() => {
    const v = params.get("treasury");
    // anything else there is not an outcome (the table is every code the World flow sends)
    return v && isResultCode("treasury", v) ? v : null;
  });
  useEffect(() => {
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("treasury");
    window.history.replaceState(window.history.state, "", url);
  }, [code]);
  return [code, () => setCode(null)];
}

/** The request the viewer approved last, while it still waits — what an "approved" banner is about. */
function lastApproved(load: RoomLoad): { got: number; need: number } | null {
  if (load.kind !== "ready") return null;
  const me = load.data.me.id;
  let best: { at: string; got: number; need: number } | null = null;
  for (const a of load.data.status.actions) {
    const mine = a.approvals.find((p) => p.userId === me);
    if (a.status !== "pending" || !mine || a.approvals.length >= a.requiredApprovals) continue;
    if (!best || mine.at > best.at) best = { at: mine.at, got: a.approvals.length, need: a.requiredApprovals };
  }
  return best;
}

function ResultBanner() {
  const t = useT();
  const { load } = useTreasuryRoom();
  const [code, dismiss] = useCallbackResult();
  if (!code) return null;
  const line = resultLine(t, code);
  if (!line) return null;
  const counted = code === "approved" ? lastApproved(load) : null;
  const copy = counted ? { ...line, text: `${line.text} ${countedLine(counted.got, counted.need, t)}` } : line;
  const tone = copy.tone === "ok" ? styles.bannerOk : copy.tone === "bad" ? styles.bannerBad : styles.bannerInfo;
  return (
    <div className={`${styles.banner} ${tone}`} role="status" data-testid="treasury-room-result">
      <ToneIcon tone={copy.tone} />
      <span>{copy.text}</span>
      <button type="button" className={styles.bannerClose} onClick={dismiss} aria-label={t("Dismiss")}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

function Tabs({ roomId }: { roomId: string }) {
  const t = useT();
  const pathname = usePathname();
  const tabs: Tab[] = [
    { href: treasuryPath(roomId), label: t("Wallet"), exact: true },
    { href: treasuryPath(roomId, "activity"), label: t("Activity"), exact: false },
    { href: treasuryPath(roomId, "treasurer"), label: t("Treasurer"), exact: false },
    { href: treasuryPath(roomId, "rules"), label: t("Rules"), exact: false },
  ];
  const here = pathname ?? "";
  return (
    <nav className={styles.tabs} aria-label={t("Treasury sections")}>
      {tabs.map((tab) => {
        const active = tab.exact ? here === tab.href : here.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`${styles.tab} ${active ? styles.tabOn : ""}`} aria-current={active ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The loaded page's columns, empty: nothing moves sideways when the treasury arrives. */
function LoadingState() {
  return (
    <div className={styles.grid} aria-busy>
      <div className={`${styles.main} ${styles.stack}`}>
        <div className={`${styles.skeleton} ${styles.skeletonHero}`} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
      <div className={styles.aside}>
        <div className={`${styles.skeleton} ${styles.treasurerCard}`} />
      </div>
    </div>
  );
}

function ErrorState({ code, onRetry }: { code: "forbidden" | "not-found" | "failed"; onRetry: () => void }) {
  const t = useT();
  const title =
    code === "forbidden"
      ? t("This treasury belongs to a relation you're not in")
      : code === "not-found"
        ? t("There's no relation here")
        : t("Couldn't load the treasury");
  return (
    <div className={`${styles.card} ${styles.empty}`} role="alert">
      <p className={styles.emptyTitle}>{title}</p>
      {code === "failed" ? (
        <button type="button" className={styles.btnDark} onClick={onRetry}>
          {t("Try again")}
        </button>
      ) : (
        <Link href="/treasury" className={styles.btnDark}>
          {t("Your treasuries")}
        </Link>
      )}
    </div>
  );
}

/** Back to the room's chat and across to the relation's doc — the two places the Treasury belongs to. */
function TopRow({ roomId, roomName, docPageId }: { roomId: string; roomName: string | null; docPageId: string | null }) {
  const t = useT();
  return (
    <div className={styles.topRow}>
      <Link
        href={`/dm/${encodeURIComponent(roomId)}`}
        className={styles.back}
        aria-label={roomName ? t("Back to {room}", { room: roomName }) : t("Back to the room")}
        data-testid="treasury-room-back"
      >
        <ChevronLeft size={18} aria-hidden />
        <span className={styles.roomTile} aria-hidden>
          {(roomName ?? "·").slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.backName}>{roomName ?? t("Back to the room")}</span>
      </Link>
      {docPageId && (
        <Link href={`/p/${docPageId}`} className={styles.docLink} aria-label={t("Open relation doc")} data-testid="treasury-room-doc">
          <FileText size={15} aria-hidden />
          <span>{t("History")}</span>
        </Link>
      )}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? "";
  const { roomId, load, reload } = useTreasuryRoom();
  const ready = load.kind === "ready" ? load.data : null;
  const roomName = ready?.room.name ?? null;
  const onTreasurerTab = pathname.startsWith(treasuryPath(roomId, "treasurer"));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <TopRow roomId={roomId} roomName={roomName} docPageId={ready?.room.docPageId ?? null} />
        <Link href="/treasury" className={styles.kicker}>
          {t("Treasury")}
          <ChevronRight size={14} aria-hidden />
        </Link>
        {/* a no-break space holds the title's line until the name arrives */}
        <h1 className={styles.title}>{roomName ?? " "}</h1>
        <Tabs roomId={roomId} />
      </header>

      <ResultBanner />

      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState code={load.code} onRetry={() => void reload()} />}
      {ready && (
        <div className={`${styles.grid} ${onTreasurerTab ? styles.gridChatFirst : ""}`}>
          <div className={styles.main}>{children}</div>
          <aside className={styles.aside} aria-label={t("Your treasurer")}>
            {onTreasurerTab ? (
              // the chat draws its own "Your treasurer" header and frame
              <div className={styles.treasurerCard} data-testid="treasury-room-treasurer">
                <TreasurerChat roomId={roomId} />
              </div>
            ) : (
              <div className={styles.asideStack}>
                <TreasurerEntry roomId={roomId} status={ready.status} agent={ready.room.members.find((p) => p.isAgent) ?? null} />
                <LatestMessage roomId={roomId} members={ready.room.members} meId={ready.me.id} />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function TreasuryRoomShell({ roomId, children }: { roomId: string; children: ReactNode }) {
  return (
    <div className={styles.root} data-testid="treasury-room">
      {/* React hoists and dedupes this stylesheet; the font stack falls back to system fonts until it lands */}
      <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" />
      <TreasuryRoomProvider roomId={roomId}>
        <Frame>{children}</Frame>
      </TreasuryRoomProvider>
    </div>
  );
}
