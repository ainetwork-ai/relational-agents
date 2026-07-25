"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Room {
  id: string;
  name: string;
  rootPageId: string | null;
}
interface Msg {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}
interface GuardResult {
  verdict: "allow" | "decline";
  checked: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: { section: string; quote: string }[];
}

/** Debounce before calling the guard after typing stops (the 700ms–1s guide from the contract). */
const GUARD_DEBOUNCE_MS = 800;

const SEED = [
  "We agreed to meet in Gangnam next Tuesday at 7pm",
  "She hasn't finished the book I lent her, Sapiens",
  "Jeju trip locked for the first week of October. I'm booking the stay",
  "She warned me she may be slow to reply while job hunting",
  "Found out her birthday is August 20 — need a gift idea",
];

export function AgentLab() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [active, setActive] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
 // pre-send fact check — a draft contradicting the relationship doc raises a decline card
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [guardedText, setGuardedText] = useState("");

  const appendLog = (s: string) => setLog((l) => [...l.slice(-19), s]);

  const loadRooms = useCallback(async () => {
    const res = await fetch("/api/agent/rooms");
    const data = await res.json();
    setRooms(data.rooms ?? []);
    return (data.rooms ?? []) as Room[];
  }, []);

  const loadMessages = useCallback(async (roomId: string) => {
    const res = await fetch(`/api/agent/rooms/${roomId}/messages`);
    const data = await res.json();
    setMessages(data.messages ?? []);
  }, []);

  useEffect(() => {
 // fetch-on-mount: setState only fires async after the fetch resolves
 // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRooms();
  }, [loadRooms]);

 // guard the draft once typing stops; resuming typing discards stale responses (version guard).
  useEffect(() => {
    if (!active || !text.trim()) {
 // eslint-disable-next-line react-hooks/set-state-in-effect
      setGuard(null);
      return;
    }
    const roomId = active.id;
    const draft = text;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/agent/rooms/${roomId}/guard`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft }),
        });
        const data = (await res.json()) as GuardResult;
        setGuard(data);
        setGuardedText(draft);
      } catch {
        setGuard(null);
      }
    }, GUARD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, active]);

 // is this decline verdict still valid for the current draft (text change invalidates it)
  const declined =
    guard?.verdict === "decline" && guard.checked && guardedText === text && text.trim().length > 0;

  async function createRoom() {
    const res = await fetch("/api/agent/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setName("");
    await loadRooms();
    setActive({ ...data.room, rootPageId: null });
    setMessages([]);
    appendLog(`Room created: ${data.room.name}`);
  }

  async function send(roomId: string, t: string) {
    if (!t.trim()) return;
    const res = await fetch(`/api/agent/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    const data = await res.json();
    if (data.autoRun && !data.autoRun.skipped) {
      appendLog(`Auto-run: processed ${data.autoRun.processed}, edits ${data.autoRun.edits}`);
      if (data.autoRun.rootPageId)
        setActive((a) => (a && a.id === roomId ? { ...a, rootPageId: data.autoRun.rootPageId } : a));
    }
    await loadMessages(roomId);
  }

  /** Send. Under a decline, only force-send goes out — the human decides. */
  function submitDraft(force: boolean) {
    if (!active || !text.trim()) return;
    if (declined && !force) return;
    void send(active.id, text);
    setText("");
    setGuard(null);
  }

  async function seed() {
    if (!active || busy) return;
    setBusy(true);
    try {
      for (const s of SEED) await send(active.id, s);
      appendLog(`Seeded ${SEED.length} messages`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!active) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/rooms/${active.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) appendLog(`Failed: ${data.error}`);
      else if (data.skipped) appendLog(`Skipped: ${data.skipped}`);
      else appendLog(`Organized: ${data.processed} messages → ${data.edits} edits`);
      const fresh = await loadRooms();
      const mine = fresh.find((r) => r.id === active.id);
      if (mine) setActive(mine);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-4xl gap-6 overflow-y-auto p-8">
      <aside className="w-56 shrink-0 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-500">Agent Lab — relationship rooms</h2>
        <Link
          data-testid="agent-lab-graph-link"
          href="/agent-lab/graph"
          className="block text-xs text-blue-600 underline"
        >
          View relationship graph →
        </Link>
        <div className="flex gap-1">
          <input
            data-testid="agent-lab-room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Room name"
            className="w-full rounded border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            data-testid="agent-lab-create-room"
            onClick={createRoom}
            className="rounded bg-neutral-900 px-2.5 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            +
          </button>
        </div>
        <ul className="space-y-1">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                data-testid="agent-lab-room-item"
                onClick={() => {
                  setActive(r);
                  loadMessages(r.id);
                }}
                className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  active?.id === r.id ? "bg-neutral-100 font-medium dark:bg-neutral-800" : ""
                }`}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 space-y-4">
        {!active ? (
          <p className="text-sm text-neutral-500">Create or pick a room.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{active.name}</h1>
              <button
                data-testid="agent-lab-seed"
                onClick={seed}
                disabled={busy}
                className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Seed conversation
              </button>
              <button
                data-testid="agent-lab-run"
                onClick={run}
                disabled={busy}
                className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Organizing…" : "Organize now"}
              </button>
              {active.rootPageId && (
                <Link
                  data-testid="agent-lab-doc-link"
                  href={`/p/${active.rootPageId}`}
                  className="text-xs text-blue-600 underline"
                >
                  Open relationship doc →
                </Link>
              )}
            </div>

            <ul className="max-h-80 space-y-1 overflow-y-auto rounded border border-neutral-200 p-3 text-sm dark:border-neutral-700">
              {messages.length === 0 && (
                <li className="text-neutral-400">No messages — seed the room or type one.</li>
              )}
              {messages.map((m) => (
                <li key={m.id} id={`msg-${m.id}`}>
                  <span className="text-neutral-400">{m.authorId.slice(0, 6)}</span> {m.text}
                </li>
              ))}
            </ul>

            {declined && (
              <div
                data-testid="agent-lab-guard-card"
                className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
              >
                <div className="font-medium text-amber-800 dark:text-amber-300">
                  ⚠️ This conflicts with the record
                </div>
                <p className="text-neutral-700 dark:text-neutral-300">{guard?.reason}</p>
                {guard?.evidence?.map((e, i) => (
                  <p key={i} className="text-neutral-500">
                    Evidence [{e.section}] “{e.quote}”
                  </p>
                ))}
                {guard?.suggestion && (
                  <p className="text-neutral-700 dark:text-neutral-300">
                    Suggested fix: {guard.suggestion}
                  </p>
                )}
                <button
                  data-testid="agent-lab-guard-force"
                  onClick={() => submitDraft(true)}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-white dark:border-neutral-600 dark:hover:bg-neutral-800"
                >
                  Send anyway
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDraft(false);
              }}
              className="flex gap-1"
            >
              <input
                data-testid="agent-lab-message-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message…"
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                data-testid="agent-lab-send"
                type="submit"
                className="rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                Send
              </button>
            </form>
          </>
        )}

        <pre
          data-testid="agent-lab-log"
          className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
        >
          {log.join("\n")}
        </pre>
      </main>
    </div>
  );
}
