"use client";

/**
 * The frame every /treasury/[roomId] tab renders in: back link, room name,
 * tabs, the World ID outcome banner, the "Your treasurer" column and the
 * latest-message dock. Its look is the Treasury product's own (coral,
 * Pretendard), scoped under one CSS-module root so nothing reaches the Notion
 * app around it. Like the overview, it renders only when the per-browser
 * Treasury switch is on.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, X } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import { useTreasuryUi } from "@/components/treasury-app/use-treasury-ui";
import { TreasurerChat } from "@/components/treasurer/treasurer-chat";
import { TreasuryRoomProvider, useTreasuryRoom } from "./room-data";
import { treasuryPath } from "./room-model";
import { RoomDock } from "./room-dock";
import styles from "./treasury-room.module.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

type Tab = { href: string; label: string; exact: boolean };

/** What the World ID callback reports on ?treasury= (callback/route.ts); unknown codes get the generic line. */
function resultCopy(t: T, code: string): { tone: "ok" | "bad" | "info"; text: string } {
  switch (code) {
    case "approved":
      return { tone: "ok", text: t("Your approval was recorded with a fresh World ID verification.") };
    case "executing":
    case "executed":
      return { tone: "ok", text: t("Quorum reached — your treasurer is carrying it out now. This page updates in a moment.") };
    case "already-approved":
      return { tone: "info", text: t("You already approved this request.") };
    case "not-pending":
      return { tone: "info", text: t("This request is no longer waiting for approvals.") };
    case "cancelled":
      return { tone: "bad", text: t("You cancelled the World ID verification — nothing was approved.") };
    case "expired":
      return { tone: "bad", text: t("This request expired before enough verified members approved it — nothing was approved.") };
    case "same-human":
      return { tone: "bad", text: t("This World ID already vouches for another account — one human, one vote. Nothing was added.") };
    case "not-seated":
      return { tone: "bad", text: t("Claim your vote with World ID in the room before approving treasury requests.") };
    case "not-electorate":
      return { tone: "bad", text: t("You joined after our rules were adopted — the relation has to re-adopt before your approval counts.") };
    default:
      return { tone: "bad", text: t("World ID didn't confirm this approval — nothing was approved. Try again.") };
  }
}

function useCallbackResult(): [string | null, () => void] {
  const params = useSearchParams();
  // the switch values share this parameter (use-treasury-ui.ts) and are not outcomes
  const [code, setCode] = useState<string | null>(() => {
    const v = params.get("treasury");
    return v && v !== "v1" && v !== "v2" ? v : null;
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
    { href: treasuryPath(roomId), label: t("Home"), exact: true },
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

function LoadingState() {
  return (
    <div className={styles.stack} aria-busy>
      <div className={`${styles.skeleton} ${styles.skeletonHero}`} />
      <div className={styles.skeleton} />
      <div className={styles.skeleton} />
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

function Frame({ children }: { children: ReactNode }) {
  const t = useT();
  const { roomId, load, reload } = useTreasuryRoom();
  const roomName = load.kind === "ready" ? load.data.room.name : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href={`/dm/${encodeURIComponent(roomId)}`} className={styles.back} data-testid="treasury-room-back">
          <ArrowLeft size={16} aria-hidden />
          {roomName ? t("Back to {room}", { room: roomName }) : t("Back to the room")}
        </Link>
        <p className={styles.kicker}>{t("Treasury")}</p>
        <h1 className={styles.title}>{roomName ?? " "}</h1>
        <Tabs roomId={roomId} />
      </header>

      <ResultBanner />

      {load.kind === "loading" && <LoadingState />}
      {load.kind === "error" && <ErrorState code={load.code} onRetry={() => void reload()} />}
      {load.kind === "ready" && (
        <div className={styles.grid}>
          <div className={styles.main}>{children}</div>
          <aside className={styles.aside} aria-label={t("Your treasurer")}>
            {/* the chat draws its own "Your treasurer" header and frame */}
            <div className={styles.treasurerCard} data-testid="treasury-room-treasurer">
              <TreasurerChat roomId={roomId} />
            </div>
          </aside>
        </div>
      )}

      {load.kind === "ready" && <RoomDock roomId={roomId} members={load.data.room.members} meId={load.data.me.id} />}
    </div>
  );
}

function SwitchOffNote({ roomId }: { roomId: string }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-sm text-neutral-600 dark:text-neutral-300">
      <p className="font-medium text-neutral-800 dark:text-neutral-100">{t("The new Treasury view is off in this browser.")}</p>
      <p className="mt-2">
        <a href={`${treasuryPath(roomId)}?treasury=v2`} className="text-blue-600 underline underline-offset-2 dark:text-blue-400">
          {t("Turn it on")}
        </a>
      </p>
    </div>
  );
}

export function TreasuryRoomShell({ roomId, children }: { roomId: string; children: ReactNode }) {
  const ui = useTreasuryUi();
  if (ui === null) return null; // before hydration the switch is unknown
  if (ui === "v1") return <SwitchOffNote roomId={roomId} />;
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
