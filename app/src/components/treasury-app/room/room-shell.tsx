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
import { TreasurerChat } from "@/components/treasurer/treasurer-chat";
import { TreasuryRoomProvider, useTreasuryRoom } from "./room-data";
import { LatestMessage } from "./latest-message";
import { treasuryPath } from "./room-model";
import { TreasurerEntry } from "./treasurer-entry";
import styles from "./treasury-room.module.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

type Tab = { href: string; label: string; exact: boolean };

/** What the World ID callback reports on ?treasury= (callback/route.ts); unknown codes get the generic line. */
function resultCopy(t: T, code: string): { tone: "ok" | "bad" | "info"; text: string } {
  switch (code) {
    case "approved":
      return { tone: "ok", text: t("Approved with World ID.") };
    case "executing":
    case "executed":
      return { tone: "ok", text: t("Approved — the treasurer is carrying it out.") };
    case "already-approved":
      return { tone: "info", text: t("You already approved this request.") };
    case "not-pending":
      return { tone: "info", text: t("This request is no longer waiting for approvals.") };
    case "cancelled":
      return { tone: "bad", text: t("World ID cancelled — nothing was approved.") };
    case "expired":
      return { tone: "bad", text: t("This request expired — nothing was approved.") };
    case "same-human":
      return { tone: "bad", text: t("This World ID already voted from another account.") };
    case "not-seated":
      return { tone: "bad", text: t("Claim your vote in the room first.") };
    case "not-electorate":
      return { tone: "bad", text: t("Your vote counts after re-adoption") };
    default:
      return { tone: "bad", text: t("World ID didn't confirm — nothing was approved.") };
  }
}

/** What the World flow puts on ?treasury= (api/auth/world/callback); anything else there is not an outcome. */
const CALLBACK_CODES: ReadonlySet<string> = new Set([
  "approved", "executing", "executed", "already-approved", "not-pending", "expired", "cancelled", "same-human",
  "not-seated", "not-electorate", "not-member", "not-found", "stale-proof", "world-id-mismatch",
  "idp-error", "bad-state", "account-switched", "verify-failed",
]);

function useCallbackResult(): [string | null, () => void] {
  const params = useSearchParams();
  const [code, setCode] = useState<string | null>(() => {
    const v = params.get("treasury");
    return v && CALLBACK_CODES.has(v) ? v : null;
  });
  useEffect(() => {
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("treasury");
    window.history.replaceState(window.history.state, "", url);
  }, [code]);
  return [code, () => setCode(null)];
}

function ResultBanner() {
  const t = useT();
  const [code, dismiss] = useCallbackResult();
  if (!code) return null;
  const copy = resultCopy(t, code);
  const tone = copy.tone === "ok" ? styles.bannerOk : copy.tone === "bad" ? styles.bannerBad : styles.bannerInfo;
  return (
    <div className={`${styles.banner} ${tone}`} role="status" data-testid="treasury-room-result">
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
