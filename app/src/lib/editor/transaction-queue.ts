/**
 * The client half of the save protocol (docs/save-protocol-target.md §5).
 *
 * Every edit becomes a Transaction that is written to IndexedDB, sent by the
 * tab's queue, and deleted only when the server has answered 200. So an edit
 * survives a crash, a closed tab, a dead network and a dead server: whatever
 * happens, it is still in `TransactionStore` until the server has it. This is
 * what Notion's TransactionQueue does (measured in docs/notion-save-protocol.md),
 * and it replaces localStorage drafts that were written only on failure and
 * thrown away after 24 hours — the two halves of how a page of KPI numbers was
 * lost on 2026-09-05.
 *
 * Timing, from the same measurements: the first transaction after a quiet
 * period goes out at once; while a request is in flight everything else
 * queues; the next request leaves 500ms after the previous response and
 * carries all of it; a failed request is retried 5s later with the SAME
 * transaction ids (the server is idempotent); never more than one in flight;
 * no `keepalive` — a tab that closes mid-flight leaves its transactions for the
 * next session, which adopts and sends them (§5.3).
 *
 * Store first, then send — strictly. Measured in Notion for one keystroke:
 * input 0ms → IndexedDB add 2.6ms → write complete 3.1ms → fetch 4.7ms. So
 * `enqueue` waits for the write's completion event before the request goes
 * out. On a page whose re-render is slow that wait includes the render (the
 * completion event is a task, and React's synchronous flush runs first); the
 * cure for that is a faster render, not a looser guarantee.
 *
 * One queue per tab (module singleton). Editors subscribe per page.
 */
import { newId } from "@/lib/compat";
import type { BlockContent, BlockType } from "@/lib/db/schema";
import type { SaveError, SaveResponse, SignedEnvelope, Transaction } from "@/lib/transactions/types";

const DB_NAME = "TransactionStore";
const DB_VERSION = 1;
/** next flush after a response (measured 501–511ms) */
const POST_RESPONSE_DELAY_MS = 500;
/** retry after a failure (measured 5.0s) */
const RETRY_MS = 5000;
/** Session heartbeat — measured in Notion at a fixed 2.5s, and written ONLY
 * while transactions are pending (an idle tab leaves no Session row). A dead
 * session's transactions were adopted by a live tab 13.6–13.7s after its tab
 * closed; 5 missed beats plus one sweep lands in that window. */
const HEARTBEAT_MS = 2500;
const ORPHAN_AFTER_MS = 12500;
const SWEEP_MS = 2500;

export type FailureKind = "network" | "server" | "rejected" | null;

export interface PageQueueState {
  /** transactions of this page still waiting for the server */
  pending: number;
  /** a request carrying this page's transactions is in flight */
  inflight: boolean;
  /** the last attempt failed and a retry is scheduled */
  lastFailure: FailureKind;
  /** the page has had at least one transaction in this tab */
  touched: boolean;
}

export interface AckInfo {
  transactions: Transaction[];
  /** `{}` when the server took them; null when it refused them for good */
  response: SaveResponse | null;
}

interface StoredTransaction extends Transaction {
  index?: number;
  sessionId: string;
}

interface StoredSession {
  index?: number;
  sessionId: string;
  ownerSessionId: string;
  updatedAt: number;
}

/** a row the queue is carrying: the transaction plus its durability promise */
interface Carried {
  t: Transaction;
  /** resolves once the IndexedDB write committed (or failed — never rejects) */
  persisted: Promise<void>;
  /** signed (when its page signs) and stored: it may go out. Rows go out in order,
   * so one still signing holds back the ones after it. */
  ready: boolean;
}

/** Signs a transaction of a page in a teamspace linked to aindrive (lib/willow/device). */
export type TransactionSigner = (t: Transaction) => Promise<SignedEnvelope>;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error("aborted"));
  });

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("Transaction")) {
        const t = db.createObjectStore("Transaction", { keyPath: "index", autoIncrement: true });
        t.createIndex("byId", "id", { unique: true });
        t.createIndex("bySessionId", "sessionId");
        t.createIndex("byPageId", "pageId");
        t.createIndex("byTimestamp", "timestamp");
      }
      if (!db.objectStoreNames.contains("Session")) {
        const s = db.createObjectStore("Session", { keyPath: "index", autoIncrement: true });
        s.createIndex("bySessionId", "sessionId", { unique: true });
        s.createIndex("byOwnerSessionId", "ownerSessionId");
        s.createIndex("byUpdatedAt", "updatedAt");
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** the stored row minus its storage bookkeeping — what goes on the wire */
function toWire(r: StoredTransaction): Transaction {
  const t: Transaction = { id: r.id, pageId: r.pageId, timestamp: r.timestamp, debug: r.debug, operations: r.operations };
  if (r.signed) t.signed = r.signed;
  return t;
}

type Listener = (s: PageQueueState) => void;
type AckListener = (a: AckInfo) => void;

export class TransactionQueue {
  readonly sessionId = newId();
  private db: Promise<IDBDatabase> | null = null;
  /** everything this tab still owes the server, oldest first */
  private carried: Carried[] = [];
  private inflight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastResponseAt = 0;
  private failure: FailureKind = null;
  private touched = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private ackListeners = new Map<string, Set<AckListener>>();
  private shareTokens = new Map<string, string>();
  private signers = new Map<string, TransactionSigner>();
  /** transactions this tab made — its editor already shows them */
  private madeHere = new Set<string>();
  private started = false;

  private open() {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  /** Begin heartbeats and orphan sweeps; idempotent. Called by the first editor. */
  start() {
    if (this.started || typeof indexedDB === "undefined") return;
    this.started = true;
    void this.beat();
    setInterval(() => void this.beat(), HEARTBEAT_MS);
    // a first sweep soon after start picks up what a closed tab left behind
    setTimeout(() => void this.sweep(), 1000);
    setInterval(() => void this.sweep(), SWEEP_MS);
    // rows this very session wrote before a reload (same sessionId cannot
    // recur, but a duplicated module instance could) are covered by sweep
  }

  setShareToken(pageId: string, token: string | undefined) {
    if (token) this.shareTokens.set(pageId, token);
    else this.shareTokens.delete(pageId);
  }

  /** Edits of `pageId` are signed before they are stored (a teamspace linked to
   * aindrive — docs/willow-ainmem-plan.md Task 6); null stops signing. */
  setSigner(pageId: string, signer: TransactionSigner | null) {
    if (signer) this.signers.set(pageId, signer);
    else this.signers.delete(pageId);
  }

  subscribe(pageId: string, fn: Listener): () => void {
    let set = this.listeners.get(pageId);
    if (!set) this.listeners.set(pageId, (set = new Set()));
    set.add(fn);
    fn(this.stateOf(pageId));
    return () => {
      set!.delete(fn);
    };
  }

  onAck(pageId: string, fn: AckListener): () => void {
    let set = this.ackListeners.get(pageId);
    if (!set) this.ackListeners.set(pageId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  stateOf(pageId: string): PageQueueState {
    const pending = this.carried.filter((c) => c.t.pageId === pageId).length;
    return {
      pending,
      inflight: this.inflight && pending > 0,
      lastFailure: pending > 0 || this.failure === "rejected" ? this.failure : null,
      touched: this.touched.has(pageId),
    };
  }

  /** Take the transaction: write it to IndexedDB, and only once that write has
   * committed let the line send it (now if idle). Resolves at the same point. */
  enqueue(t: Transaction): Promise<void> {
    this.touched.add(t.pageId);
    this.madeHere.add(t.id);
    const signer = this.signers.get(t.pageId);
    const carried: Carried = { t, persisted: Promise.resolve(), ready: false };
    // sign first, so the stored row — which a later tab may adopt and send — is
    // the signed one. A signature that cannot be made leaves the edit unsigned
    // (the server takes those, as before) rather than losing it.
    const signed = signer
      ? signer(t).then(
          (envelope) => { carried.t = { ...t, signed: envelope }; },
          () => {}
        )
      : Promise.resolve();
    const persisted = signed
      .then(() => this.open())
      .then((db) => {
        const tx = db.transaction("Transaction", "readwrite");
        tx.objectStore("Transaction").add({ ...carried.t, sessionId: this.sessionId } satisfies StoredTransaction);
        return done(tx);
      })
      .catch(() => {
        // no IndexedDB (private mode, quota): the edit still goes out from
        // memory; only crash-durability is lost
      })
      .then(() => { carried.ready = true; });
    carried.persisted = persisted;
    this.carried.push(carried);
    this.emit(t.pageId);
    // the first pending transaction starts the heartbeat at once, so a tab
    // that dies right after typing is still recognisable as a dead OWNER
    if (this.carried.length === 1) void this.beat();
    void persisted.then(() => this.schedule(0));
    return persisted;
  }

  private emit(pageId: string) {
    const s = this.stateOf(pageId);
    for (const fn of this.listeners.get(pageId) ?? []) fn(s);
  }

  /** Arrange a flush: synchronously if the line is idle, else 500ms after the
   * last response (or after `minDelay`). */
  private schedule(minDelay: number) {
    if (this.timer || this.inflight) return;
    const sinceResponse = Date.now() - this.lastResponseAt;
    const delay = Math.max(minDelay, this.lastResponseAt ? POST_RESPONSE_DELAY_MS - sinceResponse : 0, 0);
    if (delay === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  /** Synchronous up to and including fetch(). Runs only for rows whose
   * IndexedDB write has completed (see enqueue) or that were read back from it.
   * One request carries everything pending, whatever page it belongs to —
   * Notion's saveTransactionsFanout is one endpoint too. */
  private flush() {
    if (this.inflight || this.carried.length === 0) return;
    const batch: Carried[] = [];
    for (const c of this.carried) {
      if (!c.ready) break;
      batch.push(c);
    }
    if (batch.length === 0) return;
    this.inflight = true;
    const pageIds = new Set(batch.map((c) => c.t.pageId));
    for (const id of pageIds) this.emit(id);
    const headers: Record<string, string> = { "content-type": "application/json", "x-client-id": this.sessionId };
    // a share-token viewer edits one page; only then can the header be right
    const tokens = new Set([...pageIds].map((id) => this.shareTokens.get(id)).filter(Boolean));
    if (tokens.size === 1) headers["x-share-token"] = [...tokens][0]!;
    let p: Promise<Response | null>;
    try {
      p = fetch("/api/saveTransactions", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: newId(), transactions: batch.map((c) => c.t) }),
        // no keepalive, deliberately: the store is the guarantee, not the
        // browser (and keepalive's 64 KiB budget is how saves got refused)
      }).catch(() => null);
    } catch {
      p = Promise.resolve(null);
    }
    void p.then((res) => this.settle(batch, res));
  }

  private async settle(batch: Carried[], res: Response | null) {
    this.lastResponseAt = Date.now();
    const pageIds = new Set(batch.map((c) => c.t.pageId));
    this.inflight = false;
    if (res?.ok) {
      // 200 is `{}`: everything in the batch is on the server (or was already)
      this.failure = null;
      await this.acknowledge(batch, {});
      this.schedule(0);
      return;
    }
    if (res && res.status >= 400 && res.status < 500 && res.status !== 401) {
      // it will never apply — no edit right on that page, or malformed. Drop
      // exactly what the server named (or the whole batch if it named
      // nothing) so the rest keeps retrying, and say so in the badge.
      let named: string[] | null = null;
      try {
        named = ((await res.json()) as SaveError).rejectedIds ?? null;
      } catch {}
      const drop = batch.filter((c) => !named || named.includes(c.t.id));
      this.failure = "rejected";
      await this.acknowledge(drop, null);
      this.schedule(drop.length === batch.length ? 0 : RETRY_MS);
      return;
    }
    // network down, 5xx, or 401 (a session that may come back): keep everything, retry
    this.failure = res ? "server" : "network";
    for (const id of pageIds) this.emit(id);
    this.schedule(RETRY_MS);
  }

  /** Remove rows the server has (response) or refused (null) from memory,
   * tell the editors, then from the durable mirror. */
  private async acknowledge(rows: Carried[], response: SaveResponse | null) {
    const ids = new Set(rows.map((c) => c.t.id));
    this.carried = this.carried.filter((c) => !ids.has(c.t.id));
    const pageIds = new Set(rows.map((c) => c.t.pageId));
    for (const id of pageIds) {
      this.emit(id);
      const own = rows.filter((c) => c.t.pageId === id).map((c) => c.t);
      for (const fn of this.ackListeners.get(id) ?? []) fn({ transactions: own, response });
    }
    if (this.carried.length === 0) void this.beat(); // drops the Session row
    await Promise.all(rows.map((c) => c.persisted));
    try {
      const db = await this.open();
      const tx = db.transaction("Transaction", "readwrite");
      const st = tx.objectStore("Transaction");
      for (const id of ids) {
        const key = await req(st.index("byId").getKey(id));
        if (key !== undefined) st.delete(key);
      }
      await done(tx);
    } catch {}
  }

  /** Heartbeat while anything is pending; when nothing is, the Session row is
   * removed — a tab with an empty queue has nothing another tab could adopt,
   * and Notion leaves no row either. */
  private async beat() {
    try {
      const db = await this.open();
      const tx = db.transaction("Session", "readwrite");
      const st = tx.objectStore("Session");
      const existing = (await req(st.index("bySessionId").get(this.sessionId))) as StoredSession | undefined;
      if (this.carried.length === 0) {
        if (existing?.index !== undefined) st.delete(existing.index);
      } else {
        st.put({
          ...(existing ?? {}),
          sessionId: this.sessionId,
          ownerSessionId: this.sessionId,
          updatedAt: Date.now(),
        } satisfies StoredSession);
      }
      await done(tx);
    } catch {}
  }

  /** Adopt the transactions of sessions whose heartbeat stopped (a closed
   * tab, a crashed renderer) and send them. Conditional inside one IndexedDB
   * transaction so two live tabs cannot both adopt the same orphan. Rows with
   * no live session at all (the session row itself never made it) are adopted
   * the same way. */
  private async sweep() {
    const adopted: StoredTransaction[] = [];
    try {
      const db = await this.open();
      const cutoff = Date.now() - ORPHAN_AFTER_MS;
      const sessions = (await req(db.transaction("Session", "readonly").objectStore("Session").getAll())) as StoredSession[];
      const live = new Set(sessions.filter((s) => s.updatedAt >= cutoff).map((s) => s.sessionId));
      live.add(this.sessionId);
      const all = (await req(db.transaction("Transaction", "readonly").objectStore("Transaction").getAll())) as StoredTransaction[];
      const orphanSessions = new Set(all.filter((r) => !live.has(r.sessionId)).map((r) => r.sessionId));
      for (const sid of orphanSessions) {
        const tx = db.transaction(["Session", "Transaction"], "readwrite");
        const sess = tx.objectStore("Session");
        const again = (await req(sess.index("bySessionId").get(sid))) as StoredSession | undefined;
        if (again && again.updatedAt >= cutoff) {
          tx.abort();
          continue; // it came back to life between the two reads
        }
        const trs = tx.objectStore("Transaction");
        const rows = (await req(trs.index("bySessionId").getAll(sid))) as StoredTransaction[];
        for (const r of rows) trs.put({ ...r, sessionId: this.sessionId });
        if (again?.index !== undefined) sess.delete(again.index);
        await done(tx);
        adopted.push(...rows);
      }
      // dead sessions that left nothing behind: just tidy the row
      for (const s of sessions) {
        if (s.sessionId === this.sessionId || s.updatedAt >= cutoff || orphanSessions.has(s.sessionId)) continue;
        try {
          const tx = db.transaction("Session", "readwrite");
          if (s.index !== undefined) tx.objectStore("Session").delete(s.index);
          await done(tx);
        } catch {}
      }
    } catch {}
    if (adopted.length) {
      adopted.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const have = new Set(this.carried.map((c) => c.t.id));
      for (const r of adopted) {
        if (have.has(r.id)) continue;
        this.touched.add(r.pageId);
        this.carried.push({ t: toWire(r), persisted: Promise.resolve(), ready: true });
      }
      for (const pageId of new Set(adopted.map((r) => r.pageId))) this.emit(pageId);
      this.schedule(0);
    }
  }

  /**
   * Every transaction of `pageId` the server has not acknowledged yet — this
   * tab's and those a closed tab left in IndexedDB — oldest first. A page that
   * opens from an older copy (a reload while saves fail, the service worker's
   * offline snapshot) replays these on top so the edits stay on screen.
   */
  async pendingFor(pageId: string): Promise<Transaction[]> {
    const out = new Map<string, Transaction>();
    try {
      const db = await this.open();
      const rows = (await req(
        db.transaction("Transaction", "readonly").objectStore("Transaction").index("byPageId").getAll(pageId)
      )) as StoredTransaction[];
      rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const r of rows) out.set(r.id, toWire(r));
    } catch {}
    for (const c of this.carried) if (c.t.pageId === pageId && !out.has(c.t.id)) out.set(c.t.id, c.t);
    return [...out.values()];
  }

  /** pendingFor, less what this tab made itself (its editor shows those already):
   * what an earlier tab left behind, to lay over any older copy of the page. */
  async foreignPendingFor(pageId: string): Promise<Transaction[]> {
    return (await this.pendingFor(pageId)).filter((t) => !this.madeHere.has(t.id));
  }

  /** Test/diagnostic hook: what this tab still holds. */
  debugPending(): { pageId: string; id: string }[] {
    return this.carried.map((c) => ({ pageId: c.t.pageId, id: c.t.id }));
  }
}

const KEY = Symbol.for("app.transaction-queue");
/** The tab's one queue — anchored on globalThis so a duplicated module
 * instance (Turbopack prod builds do this) still shares it. */
export function getTransactionQueue(): TransactionQueue {
  const g = globalThis as unknown as Record<symbol, TransactionQueue | undefined>;
  if (!g[KEY]) g[KEY] = new TransactionQueue();
  return g[KEY]!;
}

/**
 * The previous save path kept a whole-page draft in localStorage when a save
 * failed. Anything still there is an edit the server never saw: turn it into
 * one transaction (set every block it holds, delete what it deleted) and let
 * the queue carry it. Returns the number of blocks recovered.
 */
export async function migrateLegacyDraft(pageId: string): Promise<number> {
  if (typeof localStorage === "undefined") return 0;
  const keys = [`draft-${pageId}`, `draft-archive-${pageId}`];
  let best: { blocks: Array<Record<string, unknown>>; deletedIds?: string[]; at: number } | null = null;
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const d = JSON.parse(raw);
      if (Array.isArray(d?.blocks) && (!best || (d.at ?? 0) > best.at)) best = d;
    } catch {}
  }
  if (!best) return 0;
  const ops: Transaction["operations"] = [];
  for (const b of best.blocks) {
    if (typeof b.id !== "string") continue;
    ops.push({
      command: "set",
      pointer: { table: "block", id: b.id },
      path: [],
      args: {
        id: b.id,
        type: b.type as BlockType,
        content: (b.content ?? {}) as BlockContent,
        parentBlockId: (b.parentBlockId as string | null | undefined) ?? null,
        position: typeof b.position === "number" ? b.position : 0,
      },
    });
  }
  for (const id of best.deletedIds ?? []) {
    ops.push({ command: "update", pointer: { table: "block", id }, path: [], args: { alive: false } });
  }
  if (ops.length) {
    await getTransactionQueue().enqueue({
      id: newId(),
      pageId,
      timestamp: best.at || Date.now(),
      debug: { userAction: "legacyDraft.recover", clientCommitTimeMs: Date.now() },
      operations: ops,
    });
  }
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
  return best.blocks.length;
}
