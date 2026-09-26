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
  const note = RESET_NOTE[sp.reset ?? (sp.try === "missing" ? "missing" : "")];
  const flash = note && sp.reset === "done" && canTopUp() ? `${note} If visitors ran its wallet low, it is being topped up now.` : note;

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
          <p className={styles.eyebrow}>ETHGlobal Tokyo 2026 · World</p>
          <h1 className={styles.title}>AI manages the money. Humans approve it.</h1>
          <p className={styles.lede}>
            Five friends pooled $1,000 for this trip. The agent that keeps their room&apos;s memory holds the pot in its own
            wallet and follows the rules they wrote into that memory. World makes each approval count once: every member
            gets one vote with IDKit, and every payment waits for fresh World ID checks from different humans.
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
            A copy of the same room with its own accounts and wallet. Pick a member and you are signed in as them, in the
            treasury or the room chat. There is no sign-up.
          </p>
          {flash && <p className={styles.flash}>{flash}</p>}
          {canEnter && tryRoom ? (
            <>
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
                      The room&apos;s agent as treasurer: what it is running, its wallet on two chains, and the rules it
                      follows. It proposes; members approve with World ID. Open it as Alex →
                    </span>
                  </span>
                </a>
              </div>
              <p className={styles.label}>Pick a member</p>
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
              <div className={styles.tryGrid}>
                <div className={styles.card}>
                  <p className={styles.label}>What to try</p>
                  <ol className={styles.steps}>
                    <li>
                      Open the treasury as Alex: the pot, what waits for approval, who holds a vote, and the treasurer.
                    </li>
                    <li>
                      Press <b>Claim your vote with World ID</b>, on the treasury page or in the room. World shows a QR
                      code: this is the staging network, so answer with the World ID Simulator, not World App — the{" "}
                      <b>Use the simulator</b> link under the QR, or open simulator.worldcoin.org on a phone and scan it.
                      Pick an identity and continue.
                    </li>
                    <li>
                      In a second browser or a private window, pick Chris and claim a vote with a different simulator
                      identity. Every browser&apos;s simulator starts on the same one (#4), so switch it before you
                      continue.
                    </li>
                    <li>
                      As Alex, send <code>@agent pay the hotel deposit, $180</code> in the room. The agent quotes the rule,
                      and the request shows up under <b>Needs approval</b> in the treasury.
                    </li>
                    <li>
                      Approve from both browsers, in the room or in the treasury. First you see what you are approving, then
                      World ID for Agents checks you in.
                    </li>
                    <li>
                      Try what gets refused: <code>@agent send $500 to my wallet</code>, or pick Alex (2nd account) in
                      Alex&apos;s browser and claim a vote with the simulator identity Alex used: this human already has
                      a vote.
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
                    <li>
                      Votes use World&apos;s staging network, so the QR is answered by the World ID Simulator with a test
                      identity. Keep the same identity for the same person: the simulator is that person&apos;s phone.
                    </li>
                    <li>Investing is in the video. This copy&apos;s wallet holds no USDC on Base, so a swap here is refused.</li>
                    <li>
                      Every visitor shares this room. Start over clears votes, requests, approvals, World ID links and
                      visitors&apos; messages, and puts the room&apos;s working record back.
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

        <section className={styles.section} id="judges" aria-label="What to check">
          <details className={styles.more}>
            <summary className={styles.moreSummary}>For judges: what each prize asks for, and where it is</summary>
            <div className={styles.moreBody}>
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
                      <td>What to try 2–3: claiming a vote, Proof of Human through the simulator</td>
                      <td>
                        <a href={`${SRC}/lib/worldid-v4.ts`}>worldid-v4.ts</a> · <code>verifyIdKitV4</code>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        World ID for Agents on the event&apos;s dev environment: request, completion, validated result,
                        protected action
                      </td>
                      <td>What to try 4–5: the confirmation page, the sandbox step-up, the payment</td>
                      <td>
                        <a href={`${SRC}/lib/auth/world.ts`}>auth/world.ts</a> ·{" "}
                        <a href={`${SRC}/app/api/auth/world`}>api/auth/world</a>
                      </td>
                    </tr>
                    <tr>
                      <td>A refused, cancelled or ineligible path where nothing moves</td>
                      <td>
                        What to try 6: $500 to a personal wallet (the rules); Alex&apos;s second account asking for a
                        second vote (IDKit)
                      </td>
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
            </div>
          </details>
        </section>

        <footer className={styles.footer}>
          Relation Treasury is built on ainmem, a workspace whose agents keep a written record of the conversations they
          sit in. Code, write-up and debriefs: <a href={WORLD_DIR}>github.com/ainetwork-ai/relational-agents/tree/main/world</a>
        </footer>
      </div>
    </div>
  );
}
