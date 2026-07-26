import Link from "next/link";
import { BlobInspector } from "./blob-inspector";
import {
  fetchAgent,
  formatMs,
  shortId,
  suiscanObject,
  suiscanTx,
  walrusBlobUrl,
  LIFECYCLE,
  SEAL_OUTCOMES,
  SEAL_APPROVE_SOURCE,
  REPRO_COMMAND,
  PACKAGE_ID,
  SEALED_AGENT_ID,
  LIFECYCLE_AGENT_ID,
  SECOND_AGENT_ID,
  MEMBER_A,
  MEMBER_B,
  OUTSIDER,
  NOTE_BLOB_ID,
  type LiveAgent,
} from "@/lib/sui/demo";

export const metadata = {
  title: "Relational Memory on Sui",
  description:
    "A relationship as a shared object, its memory sealed to exactly two people — live on Sui testnet.",
};

/** Judge-facing and read in a dark room: this page commits to dark. */
const SHELL = "min-h-screen w-full bg-[#08080b] text-neutral-200";

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="break-all font-mono text-[12px] text-neutral-300">{children}</span>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sky-300 underline decoration-sky-300/30 underline-offset-4 transition-colors hover:decoration-sky-300"
    >
      {children}
    </a>
  );
}

function Section({
  step,
  title,
  lede,
  children,
}: {
  step: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-neutral-900 py-12 sm:py-16">
      <p className="font-mono text-xs tracking-widest text-neutral-600">{step}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
        {title}
      </h2>
      {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-400">{lede}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}

function LiveBadge({ live }: { live: boolean }) {
  return live ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Live from testnet
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 ring-1 ring-neutral-600/40">
      Recorded receipt
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-neutral-900 py-3 first:border-t-0 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 sm:mt-0">{children}</div>
    </div>
  );
}

function AgentCard({ live, title, note }: { live: LiveAgent; title: string; note: string }) {
  const a = live.agent;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-neutral-100">{title}</h3>
        <LiveBadge live={!!a} />
      </div>
      <p className="mt-1.5 text-sm text-neutral-500">{note}</p>

      {!a ? (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Could not reach a testnet RPC ({live.error}). The object is still there:{" "}
          <ExtLink href={suiscanObject(SEALED_AGENT_ID)}>check it on Suiscan</ExtLink>.
        </p>
      ) : (
        <div className="mt-4">
          <Field label="Object">
            <ExtLink href={suiscanObject(a.objectId)}>
              <span className="break-all font-mono text-[12px]">{a.objectId}</span>
            </ExtLink>
          </Field>
          <Field label="Owner">
            <span className="text-sm text-neutral-300">
              Shared — neither member holds it alone
              {a.sharedAtVersion && (
                <span className="text-neutral-600"> (since v{a.sharedAtVersion})</span>
              )}
            </span>
          </Field>
          <Field label="Members">
            <div className="space-y-1">
              {a.members.map((m) => (
                <div key={m}>
                  <Mono>{m}</Mono>
                </div>
              ))}
            </div>
          </Field>
          <Field label="Status">
            {a.status === 0 ? (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-sm font-semibold text-emerald-300">
                Active
              </span>
            ) : (
              <span className="rounded-md bg-neutral-700/30 px-2 py-0.5 text-sm font-semibold text-neutral-300">
                Dissolved · {formatMs(a.dissolvedAtMs)}
              </span>
            )}
          </Field>
          <Field label="Created">
            <span className="font-mono text-[12px] text-neutral-400">
              {formatMs(a.createdAtMs)}
            </span>
          </Field>
          <Field label={`Memories (${a.memories.length})`}>
            {a.memories.length === 0 ? (
              <span className="text-sm text-neutral-500">none</span>
            ) : (
              <div className="space-y-2">
                {a.memories.map((m, i) => (
                  <div
                    key={`${m.blobId}-${i}`}
                    className="rounded-lg border border-neutral-800 bg-black/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
                        {m.kind}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-600">
                        {formatMs(m.createdAtMs)}
                      </span>
                    </div>
                    <div className="mt-1.5 break-all font-mono text-[12px] text-neutral-400">
                      {m.blobId.startsWith("walrus://") ? (
                        m.blobId
                      ) : (
                        <ExtLink href={walrusBlobUrl(m.blobId)}>{m.blobId}</ExtLink>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>
          <Field label="Read at">
            <span className="font-mono text-[11px] text-neutral-600">
              sui_getObject via {live.endpoint} · v{a.version}
            </span>
          </Field>
        </div>
      )}
    </div>
  );
}

export default async function SuiDemoPage() {
  const [sealed, lifecycle] = await Promise.all([
    fetchAgent(SEALED_AGENT_ID),
    fetchAgent(LIFECYCLE_AGENT_ID),
  ]);

  return (
    <main className={SHELL}>
      <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
        <header>
          <p className="font-mono text-xs tracking-widest text-sky-400/80">
            SUI TESTNET · RELATIONAL MEMORY
          </p>
          <h1 className="mt-5 text-3xl font-semibold leading-[1.15] tracking-tight text-neutral-50 sm:text-[2.75rem]">
            On our EVM version isolation is a promise the server keeps.
            <br className="hidden sm:block" />{" "}
            <span className="text-sky-300">
              On Sui it is a fact the server cannot break.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-neutral-400">
            A relationship is a thing two people jointly own, and its memory belongs to
            exactly those two. Here that is not an access-control row we choose to honour
            — it is a shared object with its own rules, and a blob we store and cannot
            read. Everything below with a green dot is fetched live while you look at it.
          </p>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <ExtLink href={suiscanObject(PACKAGE_ID)}>Package {shortId(PACKAGE_ID)}</ExtLink>
            <ExtLink href={suiscanObject(SEALED_AGENT_ID)}>
              The relationship {shortId(SEALED_AGENT_ID)}
            </ExtLink>
            <ExtLink href={walrusBlobUrl(NOTE_BLOB_ID)}>The Walrus blob</ExtLink>
          </div>
        </header>

        <Section
          step="01"
          title="The object two people own"
          lede="Not a token id in a registry mapping. An addressable thing of type relational_agent::RelationalAgent, shared, whose members field holds two addresses — read straight off testnet by this page, no cache older than 30 seconds."
        >
          <div className="grid gap-5">
            <AgentCard
              live={sealed}
              title="The relationship with the sealed memories"
              note="Created by mutual consent; two memories appended by a member."
            />
            <AgentCard
              live={lifecycle}
              title="A relationship that ended"
              note="Same package, run end to end — including dissolve. The object survives it."
            />
          </div>
        </Section>

        <Section
          step="02"
          title="The memory nobody can read"
          lede="The note and the photo were encrypted with Seal — 2-of-2 threshold across the testnet key servers, under a policy bound to this object's id — and the ciphertext went to Walrus. Only the blob id is on chain. Press the button: this fetches the real file from the public Walrus aggregator, right now."
        >
          <BlobInspector />
        </Section>

        <Section
          step="03"
          title="Who can read it, and who cannot"
          lede="Three attempts, all from the scripted run. These need private keys we will not ship to a browser, so they are recorded receipts — not live — and here is the command that reproduces them."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {SEAL_OUTCOMES.map((o) => (
              <div
                key={o.who}
                className={`rounded-2xl border p-5 ${
                  o.allowed
                    ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                    : "border-neutral-800 bg-neutral-950/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-lg ${o.allowed ? "text-emerald-400" : "text-red-400"}`}
                    aria-hidden
                  >
                    {o.allowed ? "✓" : "✕"}
                  </span>
                  <h3 className="text-sm font-semibold text-neutral-100">{o.who}</h3>
                </div>
                <p className="mt-2 text-xs text-neutral-500">asks for {o.asks}</p>
                <p
                  className={`mt-3 font-mono text-[13px] font-semibold ${
                    o.allowed ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {o.verdict}
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">{o.detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-neutral-800 bg-black/50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Reproduce · <span className="normal-case text-neutral-600">recorded receipt</span>
            </p>
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-neutral-300">
              {REPRO_COMMAND}
            </pre>
          </div>

          <div className="mt-5 rounded-xl border border-neutral-800 bg-black/50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              The whole argument, in six lines of Move
            </p>
            <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-neutral-300">
              {SEAL_APPROVE_SOURCE}
            </pre>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
              The key servers dry-run this before releasing a share. The second assert is
              the one that stops a member of{" "}
              <ExtLink href={suiscanObject(SECOND_AGENT_ID)}>another relationship</ExtLink>{" "}
              from opening this one: the decryption identity must be prefixed by this
              object&apos;s id.
            </p>
          </div>
        </Section>

        <Section
          step="04"
          title="How it begins, and how it ends"
          lede="The lifecycle, as transactions. The refusal in the middle is a failed transaction on a public chain — the strongest kind of evidence we can offer, because we could not have faked it."
        >
          <ol className="space-y-3">
            {LIFECYCLE.map((e) => (
              <li
                key={e.label}
                className={`rounded-xl border p-4 ${
                  e.outcome === "ok"
                    ? "border-neutral-800 bg-neutral-950/60"
                    : "border-red-500/30 bg-red-500/[0.06]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-neutral-100">
                    {e.label}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      e.outcome === "ok"
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-red-500/10 text-red-300"
                    }`}
                  >
                    {e.outcome === "ok" ? "executed" : "aborted by the chain"}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">{e.detail}</p>
                {e.digest && (
                  <p className="mt-2">
                    <ExtLink href={suiscanTx(e.digest)}>
                      <span className="break-all font-mono text-[11px]">{e.digest}</span>
                    </ExtLink>
                  </p>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-6 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 text-[13px] sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">Member A</p>
              <Mono>{MEMBER_A}</Mono>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">Member B</p>
              <Mono>{MEMBER_B}</Mono>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">Outsider</p>
              <Mono>{OUTSIDER}</Mono>
            </div>
          </div>
        </Section>

        <section className="border-t border-neutral-900 py-12">
          <h2 className="text-lg font-semibold text-neutral-100">What is not built yet</h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-neutral-400">
            Real on testnet: the object model, membership enforced by a failed
            transaction, Walrus storage, Seal encryption and all three refusals. Not wired
            yet: the in-app memory pipeline still writes through our own store rather than
            this package, and members here are ed25519 keypairs rather than zkLogin
            identities. We would rather show a smaller thing that is true.
          </p>
          <p className="mt-6 text-sm">
            <Link
              href="/login"
              className="text-neutral-500 underline underline-offset-4 transition-colors hover:text-neutral-300"
            >
              ← Back to the app
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
