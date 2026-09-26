import type { Metadata } from "next";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import { demoLoginEnabled, demoRoom, demoSnapshot, worldModes, type DemoSnapshot } from "@/lib/world-demo";
import styles from "./world.module.css";

export const metadata: Metadata = {
  title: "Relation Treasury — World demo",
  description: "AI manages the money. Humans approve it. The ETHGlobal Tokyo 2026 World demo, live.",
};
export const dynamic = "force-dynamic";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const REPO = "https://github.com/ainetwork-ai/relational-agents";

const when = new Intl.DateTimeFormat("en-US", {
  timeZone: TREASURY_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const money = (usd: number) => usd.toLocaleString("en-US", { style: "currency", currency: "USD" });

const STATUS_TONE: Record<string, string> = {
  executed: styles.ok,
  unconfirmed: styles.info,
  pending: styles.wait,
  blocked: styles.bad,
  failed: styles.bad,
};

const MEMBER_NOTE: Record<string, string> = {
  alex: "Requests the payments",
  bea: "A second approver",
  chris: "Approves from another browser",
  dana: "A third approver",
  eli: "A fourth approver",
  alex2: "Alex again — the same human",
};

const RESET_NOTE: Record<string, string> = {
  done: "The try-it room is fresh. If visitors ran its wallet low, it is being topped up now.",
  "too-soon": "It was just reset. Give it a few seconds.",
  missing: "The try-it room isn't set up on this server yet.",
};

function Activity({ snap }: { snap: DemoSnapshot }) {
  if (!snap.activity.length) return <p className={styles.muted}>Nothing has happened in this room yet.</p>;
  return (
    <ul className={styles.feed}>
      {snap.activity.map((a, i) => (
        <li key={i} className={styles.feedRow}>
          <span className={`${styles.dot} ${STATUS_TONE[a.status] ?? styles.idle}`} aria-hidden />
          <span className={styles.feedLine}>{a.line}</span>
          <span className={styles.feedMeta}>
            {when.format(new Date(a.at))}
            {a.txUrl && (
              <>
                {" · "}
                <a href={a.txUrl} target="_blank" rel="noreferrer">
                  tx
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function WorldPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [recording, tryRoom] = await Promise.all([demoRoom("tokyo"), demoRoom("try")]);
  const [live, trial] = await Promise.all([recording && demoSnapshot(recording), tryRoom && demoSnapshot(tryRoom)]);
  const modes = worldModes();
  const canEnter = demoLoginEnabled() && tryRoom !== null;
  const video = process.env.WORLD_DEMO_VIDEO_URL;
  const flash = RESET_NOTE[sp.reset ?? (sp.try === "missing" ? "missing" : "")];

  return (
    <div className={styles.root}>
      <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" />
      <div className={styles.wrap}>
        <header className={styles.bar}>
          <span className={styles.brand}>
            ainmem <span className={styles.brandSub}>· Relation Treasury</span>
          </span>
          <nav className={styles.links}>
            <a href={`${REPO}/tree/main/world`}>Code and write-up</a>
            <a href={`${REPO}/blob/main/world/DEMO.md`}>Demo script</a>
            <a href={`${REPO}/blob/main/world/DEBRIEF.md`}>Debriefs</a>
          </nav>
        </header>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>ETHGlobal Tokyo 2026 · World</p>
          <h1 className={styles.title}>AI manages the money. Humans approve it.</h1>
          <p className={styles.lede}>
            Five friends pooled $1,000 for this trip. The agent that keeps their room&apos;s memory holds the pot in its own
            wallet and follows the rules they wrote into that memory. World makes each approval count once: every member
            gets one vote with IDKit, and every payment waits for fresh World ID checks from different humans.
          </p>
          <div className={styles.surfaces}>
            <div className={styles.surface}>
              <p className={styles.surfaceName}>IDKit · Proof of Human</p>
              <p className={styles.surfaceText}>
                Claiming a vote. One human, one vote in each relation; a second account of the same person is refused.
              </p>
            </div>
            <div className={styles.surface}>
              <p className={styles.surfaceName}>World ID for Agents</p>
              <p className={styles.surfaceText}>
                Approving a payment. A fresh step-up every time, and two accounts of one human count once.
              </p>
            </div>
          </div>
          {video && (
            <a className={styles.primary} href={video} target="_blank" rel="noreferrer">
              Watch the 3-minute video
            </a>
          )}
        </section>

        <section className={styles.section} aria-labelledby="live">
          <h2 id="live" className={styles.h2}>
            The room from the video, live
          </h2>
          <p className={styles.sub}>
            Read-only. This is the Tokyo Trip room we recorded in. Payments move real Sepolia ETH at a demo scale of
            $200,000 per ETH.
          </p>
          {recording && live ? (
            <div className={styles.liveGrid}>
              <div className={styles.card}>
                <p className={styles.label}>In the pot</p>
                <p className={styles.balance}>{live.balanceUsd === null ? "—" : money(live.balanceUsd)}</p>
                <p className={styles.label}>Votes</p>
                <ul className={styles.chips}>
                  {live.votes.length ? (
                    live.votes.map((v) => (
                      <li key={v.name} className={`${styles.chip} ${v.world ? styles.chipWorld : ""}`}>
                        {v.name} · {v.world ? "World ID" : "dev vote"}
                      </li>
                    ))
                  ) : (
                    <li className={styles.muted}>No one has claimed a vote yet.</li>
                  )}
                </ul>
                <dl className={styles.modes}>
                  <dt>Approvals</dt>
                  <dd>
                    {modes.approvals === "sandbox"
                      ? "World ID for Agents · sandbox IdP"
                      : modes.approvals === "mock"
                        ? "Local mock IdP — not World"
                        : "Not configured"}
                  </dd>
                  <dt>Votes</dt>
                  <dd>{modes.votes ? `IDKit · World ID 4.0 (${modes.votes})` : "Dev simulator — not World"}</dd>
                </dl>
              </div>
              <div className={styles.card}>
                <p className={styles.label}>Treasury activity</p>
                <Activity snap={live} />
              </div>
            </div>
          ) : (
            <p className={styles.muted}>The recorded room isn&apos;t on this server.</p>
          )}
        </section>

        <section className={styles.section} id="try" aria-labelledby="try-title">
          <h2 id="try-title" className={styles.h2}>
            Try it yourself
          </h2>
          <p className={styles.sub}>
            A copy of the same room with its own accounts and wallet. Pick a member to enter as them. There is no sign-up.
          </p>
          {flash && <p className={styles.flash}>{flash}</p>}
          {canEnter && tryRoom ? (
            <>
              <ul className={styles.members}>
                {tryRoom.members.map((m) => (
                  <li key={m.key} className={styles.member}>
                    {m.avatarUrl ? (
                      <img className={styles.avatar} src={m.avatarUrl} alt="" width={48} height={48} />
                    ) : (
                      <span className={styles.avatar} aria-hidden />
                    )}
                    <span className={styles.memberText}>
                      <span className={styles.memberName}>{m.name}</span>
                      <span className={styles.memberNote}>{MEMBER_NOTE[m.key]}</span>
                    </span>
                    <span className={styles.memberActions}>
                      <a className={styles.enter} href={`/world/enter/${m.key}`}>
                        Enter
                      </a>
                      <a className={styles.alt} href={`/world/enter/${m.key}?to=treasury`}>
                        Account view
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
              <div className={styles.tryGrid}>
                <div className={styles.card}>
                  <p className={styles.label}>What to try</p>
                  <ol className={styles.steps}>
                    <li>
                      Enter as Alex and press <b>Claim your vote with World ID</b>. The World ID simulator opens; choose an
                      identity and continue.
                    </li>
                    <li>
                      In a second browser or a private window, enter as Chris and claim a vote with a different simulator
                      identity.
                    </li>
                    <li>
                      As Alex, send <code>@agent pay the hotel deposit, $180</code>. The agent quotes the rule and asks for 2
                      verified humans.
                    </li>
                    <li>
                      Approve from both browsers. First you see what you are approving, then World ID for Agents checks you
                      in.
                    </li>
                    <li>
                      Try what gets refused: <code>@agent send $700 to my wallet</code>, or enter as Alex (2nd account) in
                      Alex&apos;s browser and approve a request Alex already approved.
                    </li>
                  </ol>
                </div>
                <div className={styles.card}>
                  <p className={styles.label}>Good to know</p>
                  <ul className={styles.notes}>
                    <li>
                      One browser is one human. The sandbox IdP gives each browser its own fake identity and finishes
                      without a phone; in production the check comes from World App.
                    </li>
                    <li>Investing is in the video. This copy&apos;s wallet holds no USDC on Base, so a swap here is refused.</li>
                    <li>
                      Every visitor shares this room. Start over clears votes, requests, approvals, World ID links and
                      visitors&apos; messages.
                    </li>
                  </ul>
                  {trial && (
                    <p className={styles.trialState}>
                      Right now: {trial.balanceUsd === null ? "balance unavailable" : `${money(trial.balanceUsd)} in the pot`},{" "}
                      {trial.votes.length} of {tryRoom.members.length} members hold a vote, {trial.activity.length} treasury
                      event{trial.activity.length === 1 ? "" : "s"}.
                    </p>
                  )}
                  <form action="/world/reset" method="post">
                    <button type="submit" className={styles.secondary}>
                      Start over
                    </button>
                  </form>
                </div>
              </div>
            </>
          ) : (
            <p className={styles.muted}>
              {demoLoginEnabled()
                ? "The try-it room isn't set up on this server yet."
                : "Entering as a member is turned off on this server."}
            </p>
          )}
        </section>

        <footer className={styles.footer}>
          Relation Treasury is built on ainmem, a workspace whose agents keep a written record of the conversations they
          sit in. Code, write-up and debriefs: <a href={`${REPO}/tree/main/world`}>github.com/ainetwork-ai/relational-agents/tree/main/world</a>
        </footer>
      </div>
    </div>
  );
}
