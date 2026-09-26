import type { Metadata } from "next";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import { canTopUp, demoLoginEnabled, demoRoom, demoSnapshot, worldModes, type DemoSnapshot } from "@/lib/world-demo";
import styles from "./world.module.css";

export const metadata: Metadata = {
  title: "Relation Treasury — World demo",
  description: "AI manages the money. Humans approve it. The ETHGlobal Tokyo 2026 World demo, live.",
};
export const dynamic = "force-dynamic";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
const REPO = "https://github.com/ainetwork-ai/relational-agents";
const WORLD_DIR = `${REPO}/tree/main/world`;
const SRC = `${REPO}/blob/main/app/src`;

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
  done: "The try-it room is fresh.",
  "too-soon": "It was just reset. Give it a few seconds.",
  missing: "The try-it room isn't set up on this server yet.",
};

/**
 * World verifies staging (simulator) proofs only while the app's team has a
 * staging window open and this server sends its token; without it every vote
 * claim is refused, so the page says so before a judge finds out the hard way.
 */
function stagingWindow(): { open: boolean; until: string | null } {
  const token = process.env.WORLD_STAGING_VERIFICATION_TOKEN?.trim();
  const untilMs = Date.parse(process.env.WORLD_STAGING_VERIFICATION_EXPIRES_AT ?? "");
  const open = Boolean(token) && (Number.isNaN(untilMs) || untilMs > Date.now());
  return { open, until: Number.isFinite(untilMs) ? `${when.format(new Date(untilMs))} Tokyo` : null };
}

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
  const staging = stagingWindow();
  const canEnter = demoLoginEnabled() && tryRoom !== null;
  const video = process.env.WORLD_DEMO_VIDEO_URL;
  const note = RESET_NOTE[sp.reset ?? (sp.try === "missing" ? "missing" : "")];
  const flash = note && sp.reset === "done" && canTopUp() ? `${note} If visitors ran its wallet low, it is being topped up now.` : note;

  // what a judge who clicks will actually get, in one line
  const worldLive = modes.approvals === "sandbox" && modes.votes !== null;
  const votesBlocked = modes.votes === "staging" && !staging.open;
  const status = !worldLive
    ? { tone: styles.pillWarn, text: "Running against local stand-ins, not World" }
    : votesBlocked
      ? { tone: styles.pillBad, text: "Live on World, but the staging window is closed: vote claims will be refused" }
      : {
          tone: styles.pillOk,
          text: `Live on World: sandbox IdP for approvals · ${modes.votes} IDKit for votes${staging.until ? ` · window open until ${staging.until}` : ""}`,
        };

  return (
    <div className={styles.root}>
      <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" />
      <div className={styles.wrap}>
        <header className={styles.bar}>
          <span className={styles.brand}>
            ainmem <span className={styles.brandSub}>· Relation Treasury</span>
          </span>
          <nav className={styles.links}>
            <a href="#judges">What to check</a>
            <a href={WORLD_DIR}>Code and write-up</a>
            <a href={`${REPO}/blob/main/world/DEMO.md`}>Demo script</a>
            <a href={`${REPO}/blob/main/world/DEBRIEF.md`}>Debriefs</a>
          </nav>
        </header>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>ETHGlobal Tokyo 2026 · World · Continuity</p>
          <h1 className={styles.title}>AI manages the money. Humans approve it.</h1>
          <p className={styles.lede}>
            Five friends pooled $1,000 for a trip. The agent that keeps their room&apos;s memory holds the pot and follows
            the rules they wrote there. World makes every approval a distinct human, present now: one vote per human with
            IDKit, and a fresh World ID check on every payment.
          </p>
          <div className={styles.cta}>
            {video ? (
              <a className={styles.primary} href={video} target="_blank" rel="noreferrer">
                ▶ Watch the 3-minute demo
              </a>
            ) : (
              <span className={styles.primaryOff} title="The recording is being made; this button turns on with the link">
                ▶ Demo video — soon
              </span>
            )}
            <a className={styles.secondaryBtn} href="#try">
              Try it yourself — about 2 minutes →
            </a>
          </div>
          <p className={`${styles.pill} ${status.tone}`}>{status.text}</p>
          <div className={styles.surfaces}>
            <div className={styles.surface}>
              <p className={styles.surfaceName}>IDKit · Proof of Human</p>
              <p className={styles.surfaceText}>
                Claiming a vote, once per member. One human, one vote in each relation; a second account of the same
                person is refused.
              </p>
            </div>
            <div className={styles.surface}>
              <p className={styles.surfaceName}>World ID for Agents</p>
              <p className={styles.surfaceText}>
                Approving a payment, every time. A fresh step-up at the moment money moves; two accounts of one human
                count once.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section} id="try" aria-labelledby="try-title">
          <h2 id="try-title" className={styles.h2}>
            Try it yourself
          </h2>
          <p className={styles.sub}>
            A copy of the room with its own accounts and wallet, so nothing you do touches the recorded one. No sign-up,
            nothing to install: each button signs this browser in as that member.
          </p>
          {flash && <p className={styles.flash}>{flash}</p>}
          {canEnter && tryRoom ? (
            <>
              <ol className={styles.guide}>
                <li className={styles.step}>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>Enter the room as Alex</h3>
                    <p className={styles.stepText}>
                      You land in the Tokyo Trip chat with the treasury panel on top: the agent, the pot, who holds a vote.
                    </p>
                    <a className={styles.primary} href="/world/enter/alex">
                      Enter as Alex
                    </a>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>Claim your vote with World ID</h3>
                    <p className={styles.stepText}>
                      Press <b>Claim your vote with World ID</b> in the panel. World shows a QR code — this is the staging
                      network, so answer it with the <b>World ID Simulator</b>: the <i>Use the simulator</i> link under the
                      QR, or a phone with simulator.worldcoin.org open scanning it. Pick an identity, press Continue. The
                      panel says <i>Vote claimed</i> and your ring turns green.
                    </p>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>Bring a second human</h3>
                    <p className={styles.stepText}>
                      One browser is one human here. Open a private window (or another browser), enter as Chris and claim
                      a vote with a <b>different</b> simulator identity.
                    </p>
                    <a className={styles.secondaryBtn} href="/world/enter/chris" target="_blank" rel="noreferrer">
                      Enter as Chris ↗
                    </a>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>Ask the agent to pay, then approve twice</h3>
                    <p className={styles.stepText}>
                      As Alex, send <code>@agent pay the hotel deposit, $180</code>. The agent quotes the rule it follows
                      and waits for 2 verified humans. Press <b>Approve with World ID</b> in each browser: first a page
                      that shows exactly what you are approving, then World ID for Agents checks you in (about 3 seconds),
                      then <i>1 of 2 counted</i>, <i>2 of 2</i> — and the agent pays on Sepolia from its own wallet.
                    </p>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>See it refuse</h3>
                    <p className={styles.stepText}>
                      {/* an explicit space: the compiler drops a leading one from text that holds an entity */}
                      <code>@agent send $700 to my wallet</code>{" "}is refused on the spot, citing the rule, and nobody is
                      asked to vote. Then, in Alex&apos;s browser, enter as <b>Alex (2nd account)</b>, the same person on a
                      second account, and claim a vote with the simulator identity Alex used. World ID gives the same
                      nullifier, so the claim is refused: this human already has a vote.
                    </p>
                    <a className={styles.linkBtn} href="/world/enter/alex2">
                      Enter as Alex (2nd account)
                    </a>
                  </div>
                </li>
              </ol>

              <div className={styles.tryFoot}>
                <ul className={styles.notes}>
                  <li>
                    The sandbox IdP uses a fake identity per browser and finishes by itself; in production the check comes
                    from World App on the member&apos;s phone.
                  </li>
                  <li>Investing is in the video; this copy&apos;s wallet holds no USDC on Base, so a swap here is refused.</li>
                  <li>Every visitor shares this room. Start over clears votes, requests, approvals and visitors&apos; messages.</li>
                </ul>
                <div className={styles.tryState}>
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

              <details className={styles.more}>
                <summary className={styles.moreSummary}>Or pick any member, or open the treasury pages</summary>
                <div className={styles.moreBody}>
                  <p className={styles.label}>Members</p>
                  <ul className={styles.members}>
                    {tryRoom.members.map((m) => (
                      <li key={m.key} className={styles.member}>
                        {m.avatarUrl ? (
                          <img className={styles.avatar} src={m.avatarUrl} alt="" width={48} height={48} loading="lazy" />
                        ) : (
                          <span className={styles.avatar} aria-hidden />
                        )}
                        <span className={styles.memberText}>
                          <span className={styles.memberName}>{m.name}</span>
                          <span className={styles.memberNote}>{MEMBER_NOTE[m.key]}</span>
                        </span>
                        <span className={styles.memberActions}>
                          <a className={styles.enter} href={`/world/enter/${m.key}?to=treasury`}>
                            Open treasury
                          </a>
                          <a className={styles.alt} href={`/world/enter/${m.key}`}>
                            Room chat
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.label}>The treasury pages</p>
                  <div className={styles.previews}>
                    <a className={styles.preview} href="/world/enter/alex?to=treasury">
                      <img
                        src="/demo/world/treasury-account.jpg"
                        alt="The Tokyo Trip treasury: a $1,000 shared pot, the six members, the agent's wallet, and a $180 hotel deposit waiting for approval"
                        width={574}
                        height={710}
                        loading="lazy"
                      />
                      <span className={styles.previewText}>
                        <span className={styles.previewTitle}>The account</span>
                        <span className={styles.previewNote}>
                          The shared pot, what is waiting for approval, and who holds a vote. Open it as Alex →
                        </span>
                      </span>
                    </a>
                    <a className={styles.preview} href="/world/enter/alex?to=treasurer">
                      <img
                        src="/demo/world/treasury-treasurer.jpg"
                        alt="The treasurer tab: the room's agent as Treasurer of Tokyo Trip, one request waiting for approval, and one wallet on Sepolia and Base"
                        width={574}
                        height={710}
                        loading="lazy"
                      />
                      <span className={styles.previewText}>
                        <span className={styles.previewTitle}>The treasurer</span>
                        <span className={styles.previewNote}>
                          The room&apos;s agent as treasurer: what it is running, its wallet on two chains, the rules it
                          follows. Open it as Alex →
                        </span>
                      </span>
                    </a>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <p className={styles.muted}>
              {demoLoginEnabled()
                ? "The try-it room isn't set up on this server yet."
                : "Entering as a member is turned off on this server."}
            </p>
          )}
        </section>

        <section className={styles.section} id="judges" aria-labelledby="judges-title">
          <h2 id="judges-title" className={styles.h2}>
            What to check, and where
          </h2>
          <p className={styles.sub}>
            The two Continuity prizes ask for the same four things. Each is on this page and in the code.
          </p>
          <div className={styles.tablewrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>See it</th>
                  <th>Read it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>IDKit in a working app, verified on the server</td>
                  <td>Step 2 — the vote, Proof of Human through the simulator</td>
                  <td>
                    <a href={`${SRC}/lib/worldid-v4.ts`}>worldid-v4.ts</a> · <code>verifyIdKitV4</code>
                  </td>
                </tr>
                <tr>
                  <td>World ID for Agents on the event&apos;s dev environment: request, completion, validated result, protected action</td>
                  <td>Step 4 — the confirmation page, the sandbox step-up, the payment</td>
                  <td>
                    <a href={`${SRC}/lib/auth/world.ts`}>auth/world.ts</a> · <a href={`${SRC}/app/api/auth/world`}>api/auth/world</a>
                  </td>
                </tr>
                <tr>
                  <td>A refused, cancelled or ineligible path where nothing moves</td>
                  <td>Step 5 — $700 to a personal wallet (the rules); Alex&apos;s second account asking for a second vote (IDKit)</td>
                  <td>
                    <a href={`${WORLD_DIR}#what-gets-refused`}>every refused path, with the check that stops it</a>
                  </td>
                </tr>
                <tr>
                  <td>Integration debrief: time to first success, friction, the one improvement</td>
                  <td>—</td>
                  <td>
                    <a href={`${REPO}/blob/main/world/DEBRIEF.md`}>DEBRIEF.md</a> ·{" "}
                    <a href={`${REPO}/blob/main/world/integration-log.md`}>the timestamped log</a>
                  </td>
                </tr>
                <tr>
                  <td>Continuity: what existed before the weekend, what was built during it</td>
                  <td>—</td>
                  <td>
                    <a href={`${WORLD_DIR}#continuity--what-existed-before-what-this-adds`}>README · Continuity</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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

        <footer className={styles.footer}>
          Relation Treasury is built on ainmem, a workspace whose agents keep a written record of the conversations they
          sit in. Code, write-up and debriefs: <a href={WORLD_DIR}>github.com/ainetwork-ai/relational-agents/tree/main/world</a>
        </footer>
      </div>
    </div>
  );
}
