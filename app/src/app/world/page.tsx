import type { Metadata } from "next";
import { RATIFY_KIND, TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";
import {
  canTopUp,
  demoLoginEnabled,
  demoRoom,
  demoSnapshot,
  worldModes,
  type DemoEntry,
  type DemoFace,
  type DemoSnapshot,
} from "@/lib/world-demo";
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
const clock = new Intl.DateTimeFormat("en-US", { timeZone: TREASURY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = new Intl.DateTimeFormat("en-US", { timeZone: TREASURY_TIME_ZONE, month: "short", day: "numeric" });

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

const RING: Record<string, string> = { world: styles.ringWorld, dev: styles.ringDev };
const VOTE_TITLE: Record<string, string> = { world: "vote claimed with World ID", dev: "test vote placed by the seed" };

function Face({ face, size = 32, ring }: { face: DemoFace; size?: number; ring?: string | null }) {
  const cls = `${styles.face} ${ring === undefined ? "" : (RING[ring ?? ""] ?? styles.ringNone)}`;
  return face.avatarUrl ? (
    <img className={cls} src={face.avatarUrl} alt="" width={size} height={size} />
  ) : (
    <span className={`${cls} ${styles.faceBlank}`} style={{ width: size, height: size }} aria-hidden>
      {face.name.slice(0, 1)}
    </span>
  );
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Hotel deposit" → Hotel Gracery Shinjuku; a request with no memo is named by where it would go */
function entryTitle(e: DemoEntry): { title: string; payee: string | null } {
  if (e.kind === RATIFY_KIND) return { title: "Treasury rules adopted", payee: null };
  if (e.kind === "recurring-buy") return { title: "Recurring buy adopted", payee: null };
  if (e.kind === "investment") return { title: "Invested idle funds", payee: e.payee };
  if (e.memo) return { title: capitalize(e.memo), payee: e.payee };
  return { title: e.payee ? `To ${e.payee}` : "Payment", payee: null };
}

function EntryMeta({ e }: { e: DemoEntry }) {
  const asked = e.requester ? `${e.requester.name} asked` : null;
  if (e.kind === RATIFY_KIND) return <>The rules the friends agreed in this room&apos;s chat</>;
  if (e.status === "blocked")
    return (
      <>
        {asked && `${asked} · `}refused by the rules: <q>{e.ruleText}</q> Nothing moved.
      </>
    );
  const names = e.approvers.map((a) => a.name).join(", ");
  return (
    <>
      {asked}
      {e.approvers.length > 0 && (
        <>
          {asked && " · approved by "}
          <span className={styles.approverFaces}>
            {e.approvers.map((a) => (
              <Face key={a.name} face={a} size={20} />
            ))}
          </span>
          {names} · {e.approvers.length} of {e.required} with World ID
        </>
      )}
      {e.status === "executed" && e.required === 0 && e.approvers.length === 0 && " · under the bar the agent pays alone"}
      {e.status === "pending" && ` · waiting: ${e.approvers.length} of ${e.required} approved`}
      {!["executed", "pending"].includes(e.status) && ` · ${e.line}`}
    </>
  );
}

/**
 * The recorded room as a statement: the friends and their votes, the pot, and
 * each thing the treasury did in the order the video shows it — who asked, who
 * approved, where the money went, and the transaction to check it against.
 */
function Statement({ snap, modes }: { snap: DemoSnapshot; modes: ReturnType<typeof worldModes> }) {
  const withVote = snap.people.filter((p) => p.vote);
  const without = snap.people.filter((p) => !p.vote);
  const entries = [...snap.activity].reverse();
  return (
    <div className={styles.statement}>
      <div className={styles.stHead}>
        <div className={styles.stPeople}>
          <ul className={styles.faces} aria-label="Members and their votes">
            {snap.people.map((p) => (
              <li key={p.name} title={`${p.name}: ${p.vote ? VOTE_TITLE[p.vote] : "no vote"}`}>
                <Face face={p} size={40} ring={p.vote} />
              </li>
            ))}
          </ul>
          <p className={styles.stVotes}>
            <b>
              {withVote.length} of {snap.people.length}
            </b>{" "}
            hold a vote, each a World ID proof of human.
            {without.length > 0 && ` Without one: ${without.map((p) => p.name).join(", ")}.`}
          </p>
        </div>
        <div className={styles.stPot}>
          <p className={styles.stPotLabel}>In the pot now</p>
          <p className={styles.stPotValue}>{snap.balanceUsd === null ? "—" : money(snap.balanceUsd)}</p>
          <p className={styles.stPotNote}>of the $1,000 the five pooled</p>
        </div>
      </div>
      {entries.length ? (
        <>
          <p className={styles.ledgerDay}>{dayOf.format(new Date(entries[0].at))} · Tokyo time</p>
          <ol className={styles.ledger}>
            {entries.map((e, i) => {
              const { title, payee } = entryTitle(e);
              const refused = e.status === "blocked";
              return (
                <li key={i} className={styles.entry}>
                  <time className={styles.entryTime} dateTime={e.at}>
                    {clock.format(new Date(e.at))}
                  </time>
                  <span className={styles.entryFace}>{e.requester && <Face face={e.requester} />}</span>
                  <div className={styles.entryBody}>
                    <p className={styles.entryTitle}>
                      {title}
                      {payee && <span className={styles.entryPayee}> → {payee}</span>}
                    </p>
                    <p className={styles.entryMeta}>
                      <EntryMeta e={e} />
                    </p>
                  </div>
                  <div className={styles.entryRight}>
                    {e.kind !== RATIFY_KIND && e.kind !== "recurring-buy" && (
                      <p className={`${styles.entryAmount} ${refused ? styles.amountRefused : ""}`}>
                        {refused || e.status !== "executed" ? money(e.amountUsd) : `−${money(e.amountUsd)}`}
                      </p>
                    )}
                    {e.txUrl ? (
                      <a className={styles.txLink} href={e.txUrl} target="_blank" rel="noreferrer">
                        {e.explorer ?? "Transaction"} ↗
                      </a>
                    ) : refused ? (
                      <span className={styles.refusedTag}>Refused</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className={styles.muted}>Nothing has happened in this room yet.</p>
      )}
      <p className={styles.stFoot}>
        Votes:{" "}
        {modes.votes ? `IDKit, World ID 4.0 on World's ${modes.votes} network` : "a local simulator, not World"} ·
        Approvals:{" "}
        {modes.approvals === "sandbox"
          ? "World ID for Agents, the event's sandbox IdP"
          : modes.approvals === "mock"
            ? "a local mock IdP, not World"
            : "not configured"}
      </p>
    </div>
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
            Read-only: the Tokyo Trip room we recorded in, as it is right now. Every payment links to its transaction, so
            you can check it on the chain yourself. Sepolia ETH counts at a demo scale of $200,000 per ETH.
          </p>
          {recording && live ? (
            <Statement snap={live} modes={modes} />
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
