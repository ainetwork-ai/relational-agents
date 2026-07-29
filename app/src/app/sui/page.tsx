import Link from "next/link";
import { ArrowLeft, Bot, Check, FileText, ImageIcon, Lock, X } from "lucide-react";
import { BlobInspector } from "./blob-inspector";
import {
  fetchAgent,
  formatMs,
  shortId,
  suiscanObject,
  suiscanTx,
  walrusBlobUrl,
  AVA,
  CHANHO,
  HANNAH,
  LIFECYCLE,
  ROOM_OTHER,
  ROOM_SEALED,
  SEAL_OUTCOMES,
  SEAL_APPROVE_SOURCE,
  REPRO_COMMAND,
  PACKAGE_ID,
  SEALED_AGENT_ID,
  LIFECYCLE_AGENT_ID,
  SECOND_AGENT_ID,
  NOTE_BLOB_ID,
  type LiveAgent,
} from "@/lib/sui/demo";

export const metadata = {
  title: "Sealed to two people — Relational memory on Sui",
  description:
    "Chanho and Hannah's egg tart, kept in a relationship only they can open. Live on Sui testnet.",
};

const PAGE = "min-h-screen w-full bg-white text-neutral-800 dark:bg-[#191919] dark:text-neutral-200";

/** The app's card: white, hairline border, soft radius, quiet in dark. */
const CARD =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800/60";

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="break-all font-mono text-[11.5px] text-neutral-500 dark:text-neutral-400">
      {children}
    </span>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 underline underline-offset-2 decoration-blue-600/30 transition-colors hover:decoration-blue-600 dark:text-blue-400 dark:decoration-blue-400/30 dark:hover:decoration-blue-400"
    >
      {children}
    </a>
  );
}

function SectionHead({
  icon,
  eyebrow,
  title,
  lede,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {icon} {eyebrow}
      </h2>
      <h3 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{title}</h3>
      {lede && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {lede}
        </p>
      )}
    </div>
  );
}

function Section({
  icon,
  eyebrow,
  title,
  lede,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <SectionHead icon={icon} eyebrow={eyebrow} title={title} lede={lede} />
      {children}
    </section>
  );
}

/** The relationship's face, the way the app writes it: "Hannah ❤️ Chanho". */
function RoomChip({ title, muted }: { title: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        muted
          ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300"
      }`}
    >
      {title}
    </span>
  );
}

function LiveDot({ live }: { live: boolean }) {
  return live ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Live from testnet
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      Recorded receipt
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-neutral-100 py-2.5 first:border-t-0 dark:border-neutral-700/60 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-4">
      <div className="text-xs font-medium text-neutral-400">{label}</div>
      <div className="mt-0.5 sm:mt-0">{children}</div>
    </div>
  );
}

function AgentCard({
  live,
  room,
  note,
  people,
  muted,
}: {
  live: LiveAgent;
  room: string;
  note: string;
  people: string[];
  muted?: boolean;
}) {
  const a = live.agent;
  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RoomChip title={room} muted={muted} />
        <LiveDot live={!!a} />
      </div>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{note}</p>

      {!a ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
          Could not reach a testnet RPC ({live.error}). The object is still there:{" "}
          <ExtLink href={suiscanObject(SEALED_AGENT_ID)}>check it on Suiscan</ExtLink>.
        </p>
      ) : (
        <div className="mt-3">
          <Field label="Owner">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">
              Shared — neither of them holds it alone
            </span>
          </Field>
          <Field label="Members">
            <div className="space-y-1.5">
              {a.members.map((m, i) => (
                <div key={m} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {people[i] ?? "Member"}
                  </span>
                  <Mono>{shortId(m, 8, 6)}</Mono>
                </div>
              ))}
            </div>
          </Field>
          <Field label="Status">
            {a.status === 0 ? (
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Active
              </span>
            ) : (
              <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                Dissolved · {formatMs(a.dissolvedAtMs)}
              </span>
            )}
          </Field>
          <Field label={`Memories (${a.memories.length})`}>
            {a.memories.length === 0 ? (
              <span className="text-sm text-neutral-400">none</span>
            ) : (
              <div className="space-y-1.5">
                {a.memories.map((m, i) => (
                  <div key={`${m.blobId}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="inline-flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-300">
                      {m.kind === "photo" ? <ImageIcon size={13} /> : <FileText size={13} />}
                      {m.kind}
                    </span>
                    {m.blobId.startsWith("walrus://") ? (
                      <Mono>{m.blobId}</Mono>
                    ) : (
                      <ExtLink href={walrusBlobUrl(m.blobId)}>
                        <span className="break-all font-mono text-[11.5px]">
                          {shortId(m.blobId, 8, 6)}
                        </span>
                      </ExtLink>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Field>
          <Field label="Read at">
            <Mono>
              sui_getObject via {live.endpoint} · v{a.version}
            </Mono>
          </Field>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300">
              Object and member ids
            </summary>
            <div className="mt-2 space-y-1.5">
              <div>
                <ExtLink href={suiscanObject(a.objectId)}>
                  <span className="break-all font-mono text-[11.5px]">{a.objectId}</span>
                </ExtLink>
              </div>
              {a.members.map((m) => (
                <div key={m}>
                  <Mono>{m}</Mono>
                </div>
              ))}
            </div>
          </details>
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
    <main className={PAGE}>
      <div className="mx-auto w-full max-w-4xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="mb-12">
          <Link
            href="/login"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={14} /> Back to the app
          </Link>

          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <Lock size={12} /> Relational memory on Sui testnet
          </h2>
          <h1 className="text-2xl font-bold leading-snug text-neutral-900 dark:text-neutral-100 sm:text-3xl">
            One relationship, one agent, one memory —
            <br className="hidden sm:block" /> and here the memory is sealed to two people.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            In the app, {ROOM_SEALED} is a room with its own agent and its own record. Every
            other relationship gets its own, and nothing crosses over. This page is that same
            rule written somewhere we cannot quietly change our minds: the relationship is a
            shared object on Sui, its memory is a file we store and cannot read, and the
            refusals below are the chain&apos;s, not ours.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-neutral-400">
            Anything marked <span className="font-medium text-emerald-600 dark:text-emerald-400">live</span>{" "}
            is fetched while you look at it.
          </p>
        </header>

        <Section
          icon={<FileText size={12} />}
          eyebrow="The memory"
          title="Midnight egg tarts, Lisbon"
          lede={`Chanho dropped the photo into the ${ROOM_SEALED} chat and their agent filed it into the relationship record. This is what it wrote — and what only the two of them can read back.`}
        >
          <div className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3 dark:border-neutral-700/60">
              <RoomChip title={ROOM_SEALED} />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400">
                <Lock size={12} /> Sealed to 2 members
              </span>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/egg-tart.jpg"
                alt="Egg tarts on a bakery counter, late at night in Lisbon"
                className="h-48 w-full rounded-lg object-cover sm:h-full"
              />
              <div className="min-w-0">
                <h4 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  The egg tart
                </h4>
                <p className="mt-2 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                  We walked past the bakery twice before going in. She said the crust was
                  better than the one in Lisbon; he disagreed, loudly, and then ate two.
                </p>
                <p className="mt-4 text-xs text-neutral-400">
                  219 bytes of note and a 17 KB photo. Both were encrypted with Seal — a
                  2-of-2 threshold across the testnet key servers, under a policy bound to
                  this relationship&apos;s object id — and the ciphertext went to Walrus.
                  Only the blob id is on chain.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section
          icon={<Lock size={12} />}
          eyebrow="Live"
          title="What anyone else gets"
          lede="The file is public. Walrus will hand it to you, to us, to anyone — no key, no permission. Press the button and pull the real bytes off the public aggregator right now."
        >
          <BlobInspector />
        </Section>

        <Section
          icon={<Bot size={12} />}
          eyebrow="Recorded receipts"
          title="Who can open it, and who cannot"
          lede={`Three attempts from the scripted run. The third is the one the demo is about: Chanho asks the ${ROOM_OTHER} agent about egg tarts, and it has no way to reach Hannah's memory. These need private keys we will not ship to a browser, so they are recorded, not live — the command that reproduces them is below.`}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {SEAL_OUTCOMES.map((o) => (
              <div
                key={o.who}
                className={`rounded-xl border p-4 ${
                  o.allowed
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
                    : "border-neutral-200 bg-neutral-50/60 dark:border-neutral-700 dark:bg-neutral-800/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      o.allowed
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }
                    aria-hidden
                  >
                    {o.allowed ? <Check size={15} /> : <X size={15} />}
                  </span>
                  <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {o.who}
                  </h4>
                </div>
                <p className="mt-1 text-xs text-neutral-400">{o.role}</p>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Asks for {o.asks}
                </p>
                <p
                  className={`mt-3 text-[13px] font-semibold ${
                    o.allowed
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-600 dark:text-red-300"
                  }`}
                >
                  {o.verdict}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {o.detail}
                </p>
              </div>
            ))}
          </div>

          <div className={`${CARD} mt-4 p-4`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              The rule, in six lines of Move
            </p>
            <pre className="overflow-x-auto rounded-lg bg-neutral-50 p-3 font-mono text-[11.5px] leading-relaxed text-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300">
              {SEAL_APPROVE_SOURCE}
            </pre>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              The key servers dry-run this before releasing a share. The second assert is what
              stops{" "}
              <ExtLink href={suiscanObject(SECOND_AGENT_ID)}>{ROOM_OTHER}</ExtLink> from
              opening {ROOM_SEALED}: the decryption identity must be prefixed by this
              object&apos;s id.
            </p>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300">
                Reproduce the receipts
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-400">
                {REPRO_COMMAND}
              </pre>
            </details>
          </div>
        </Section>

        <Section
          icon={<Bot size={12} />}
          eyebrow="Live"
          title="The relationship, as an object two people own"
          lede="Not a row in our database and not a token id in a registry mapping — an addressable thing of type relational_agent::RelationalAgent, shared, whose members field holds exactly two addresses. Read straight off testnet by this page, no cache older than 30 seconds."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <AgentCard
              live={sealed}
              room={ROOM_SEALED}
              people={[CHANHO.name, HANNAH.name]}
              note="Born by mutual consent; the note and the photo appended by a member."
            />
            <AgentCard
              live={lifecycle}
              room="A relationship that ended"
              muted
              people={[CHANHO.name, HANNAH.name]}
              note="The same package run end to end, including dissolve. The record outlives the relationship."
            />
          </div>
        </Section>

        <Section
          icon={<FileText size={12} />}
          eyebrow="Recorded receipts"
          title="How it begins, and how it ends"
          lede="The lifecycle as transactions. The refusal in the middle is a failed transaction on a public chain — the strongest evidence we can offer, because we could not have faked it."
        >
          <ol className="space-y-2">
            {LIFECYCLE.map((e) => (
              <li
                key={e.label}
                className={`rounded-xl border p-4 ${
                  e.outcome === "ok"
                    ? "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/60"
                    : "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {e.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      e.outcome === "ok"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                    }`}
                  >
                    {e.outcome === "ok" ? "executed" : "aborted by the chain"}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {e.detail}
                </p>
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

          <details className={`${CARD} mt-4 p-4 text-xs`}>
            <summary className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300">
              The demo wallets, and where to look everything up
            </summary>
            <p className="mt-3 leading-relaxed text-neutral-500 dark:text-neutral-400">
              The scripted runs signed with three throwaway ed25519 keypairs. These are the
              demo characters those keys stand for — the addresses are exactly what the chain
              recorded; only the names are ours.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[CHANHO, HANNAH, AVA].map((p) => (
                <div key={p.address}>
                  <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    {p.name}
                  </p>
                  <Mono>{p.address}</Mono>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <ExtLink href={suiscanObject(PACKAGE_ID)}>Package {shortId(PACKAGE_ID)}</ExtLink>
              <ExtLink href={suiscanObject(SEALED_AGENT_ID)}>
                The relationship {shortId(SEALED_AGENT_ID)}
              </ExtLink>
              <ExtLink href={walrusBlobUrl(NOTE_BLOB_ID)}>The Walrus blob</ExtLink>
            </div>
          </details>
        </Section>

        <section className="border-t border-neutral-200 pt-8 dark:border-neutral-700">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            What is not built yet
          </h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Real on testnet: the object model, membership enforced by a failed transaction,
            Walrus storage, Seal encryption and all three refusals. Not wired yet: the in-app
            memory pipeline still writes through our own store rather than this package, and
            members here are ed25519 keypairs rather than the wallets people sign in with. We
            would rather show a smaller thing that is true.
          </p>
          <p className="mt-6">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <ArrowLeft size={14} /> Back to the app
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
