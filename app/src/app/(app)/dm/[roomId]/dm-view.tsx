"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImagePlus, Lock, LogOut, Pencil, Phone, PhoneMissed, Send, Sparkles, UserPlus, X, Bot } from "lucide-react";
import { newId } from "@/lib/compat";
import { useDmEvents } from "@/hooks/use-dm-events";
import { useDmRoomsStore, type DmUser } from "@/stores/dm-rooms";
import { useToastStore } from "@/stores/toast";
import { DmAvatar } from "@/components/dm/dm-avatar";
import { CallButton } from "@/components/call/call-button";
import { ConsentBanner } from "@/components/dm/consent-banner";
import { DissolveBanner } from "@/components/dm/dissolve-banner";
import { signTypedDataWithWallet } from "@/lib/wallet/sign";
import { WalletSignatureError } from "@/lib/wallet/provider";

/** Block explorer for the chain the relation registry is deployed on. */
const EXPLORER_BY_CHAIN: Record<string, string> = {
  "1": "https://etherscan.io",
  "11155111": "https://sepolia.etherscan.io",
  "8453": "https://basescan.org",
  "84532": "https://sepolia.basescan.org",
};
const EXPLORER_BASE =
  EXPLORER_BY_CHAIN[process.env.NEXT_PUBLIC_RELATION_REGISTRY_CHAIN_ID ?? "11155111"] ??
  "https://sepolia.etherscan.io";

interface GuardResult {
  verdict: "allow" | "decline";
  checked: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: { section: string; quote: string }[];
}

interface DmRoomDetail {
  id: string;
  name: string;
  kind: string;
  createdBy: string;
  createdAt: string;
  rootPageId: string | null;
}

interface DmAttachment {
  url: string;
  name: string;
}

interface DmMessage {
  id: string;
  roomId: string;
  authorId: string;
  text: string;
  attachments: DmAttachment[];
  createdAt: string;
  /** set on a private exchange with the agent — only this member ever sees it */
  privateToUserId?: string | null;
  /** set once the agent folded this message into the shared record */
  recordedAt?: string | null;
}

const TYPING_TTL_MS = 3_500;
const TYPING_PING_MS = 2_000;
/** Delay before guarding the draft after typing stops (sending is instant regardless). */
const GUARD_DEBOUNCE_MS = 800;
const MAX_ATTACHMENTS = 8;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

/** Human↔human DM room view — realtime receive (SSE inbox), photo
 * attachments, invite/rename/leave, and the agent's "AI organize"
 * (relationship-doc creation), all in one screen.
 *
 * variant="call" embeds this same chat (same composer, same bubbles,
 * @agent included) as the in-call side panel: the room header and banners
 * drop away and the parent decides the width. */
export function DmView({
  roomId,
  variant = "page",
}: {
  roomId: string;
  variant?: "page" | "call";
}) {
  const router = useRouter();
  const show = useToastStore((s) => s.show);
  const markReadLocal = useDmRoomsStore((s) => s.markReadLocal);
  const loadRooms = useDmRoomsStore((s) => s.load);

  const [room, setRoom] = useState<DmRoomDetail | null>(null);
  const [members, setMembers] = useState<DmUser[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [authors, setAuthors] = useState<DmUser[]>([]);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [pendingAtt, setPendingAtt] = useState<DmAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [candidates, setCandidates] = useState<DmUser[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [organizing, setOrganizing] = useState(false);
 // relationship agent: whether it's invited + invite in flight
  const [hasAgent, setHasAgent] = useState<boolean | null>(null);
  const [inviting, setInviting] = useState(false);
 // pre-send fact check (decline). The send path is untouched — parallel checking while typing only.
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [guardedText, setGuardedText] = useState("");

 // per-tab client id — for ignoring our own SSE echo (sent as x-client-id)
  const clientId = useMemo(() => newId(), []);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastTypingSentRef = useRef(0);
  const renameRef = useRef<HTMLInputElement>(null);

 // mark read only while the tab is actually visible — background arrivals keep their badge.
  const pendingReadRef = useRef(false);
  const markRead = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      pendingReadRef.current = true;
      return;
    }
    pendingReadRef.current = false;
    await fetch(`/api/dm/rooms/${roomId}/read`, { method: "POST" }).catch(() => {});
    markReadLocal(roomId);
  }, [roomId, markReadLocal]);

  const loadedRef = useRef(false);
  /** Check whether this room has the relationship agent (drives the header button). */
  const loadAgent = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/agent`);
    setHasAgent(res.ok);
  }, [roomId]);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Conversation not found." : "You can't access this conversation.");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as {
        meId: string;
        room: DmRoomDetail;
        members: DmUser[];
        authors: DmUser[];
        messages: DmMessage[];
      };
      loadedRef.current = true;
 // set meId atomically with room/messages → no races in bubble sides / typing judgments
      setMeId(data.meId);
      setRoom(data.room);
      setMembers(data.members);
      setAuthors(data.authors);
      setMessages(data.messages);
      setError(null);
      setLoading(false);
      void markRead();
    } catch {
 // transient network error: show it on first load, keep the view if already shown (SSE hello retries)
      setLoading(false);
      if (!loadedRef.current) setError("Could not load the conversation.");
    }
  }, [roomId, markRead]);

  const refetchMessages = useCallback(async () => {
    const res = await fetch(`/api/dm/rooms/${roomId}/messages`);
    if (!res.ok) return;
    const { messages: next } = (await res.json()) as { messages: DmMessage[] };
    setMessages(next);
    void markRead();
  }, [roomId, markRead]);

  useEffect(() => {
 // fetch-on-mount: meId rides in this GET, so no separate /api/auth/me race
 // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
 // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAgent();
  }, [loadAgent]);

 // guard the draft once typing stops. **The send path is untouched** — the
 // check runs in parallel and a late result never delays sending. A text
 // change invalidates the old verdict (version guard).
  useEffect(() => {
    if (!input.trim()) {
 // eslint-disable-next-line react-hooks/set-state-in-effect
      setGuard(null);
      return;
    }
    const draft = input;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/agent/rooms/${roomId}/guard`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft }),
        });
        if (!res.ok) return;
        setGuard((await res.json()) as GuardResult);
        setGuardedText(draft);
      } catch {
        /* guard failures are silently ignored — sending is never blocked */
      }
    }, GUARD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, roomId]);

  /** is the decline verdict still valid for this draft (text change invalidates) */
  const declined =
    guard?.verdict === "decline" && guard.checked && guardedText === input && input.trim().length > 0;

 // when the tab becomes visible again, flush pending read marks (clears badges for background arrivals)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pendingReadRef.current) void markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

 // auto-focus the composer after load
  useEffect(() => {
    if (!loading && !error) composerRef.current?.focus();
  }, [loading, error]);

 // scroll to bottom on new messages / typing changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, typing]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

 // drop expired typing indicators
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const alive = Object.entries(prev).filter(([, v]) => v.until > now);
        return alive.length === Object.keys(prev).length ? prev : Object.fromEntries(alive);
      });
    }, 1_000);
    return () => clearInterval(t);
  }, []);

  useDmEvents(
    (event) => {
      if (event.roomId !== roomId) return;
      if (event.type === "dm-typing") {
 // ignore both this tab's echo (clientId) and my other tabs (user.id)
        if (event.clientId && event.clientId === clientId) return;
        if (!event.user || event.user.id === meId) return;
        const u = event.user;
        setTyping((prev) => ({
          ...prev,
          [u.id]: { name: u.displayName, until: Date.now() + TYPING_TTL_MS },
        }));
        return;
      }
      if (event.type === "dm-message") {
        if (event.clientId && event.clientId === clientId) return; // my echo — already applied from the POST response
        void refetchMessages();
        return;
      }
 // dm-room: name/member changes (if I was removed, 403/404 → show error)
      void loadAll();
    },
 // SSE (re)connect — recover messages missed while down
    () => void loadAll()
  );

  const userById = useMemo(() => {
    const map = new Map<string, DmUser>();
    for (const u of [...members, ...authors]) map.set(u.id, u);
    return map;
  }, [members, authors]);

  const others = members.filter((m) => m.id !== meId);
  const title =
    room?.name || (others.length ? others.map((o) => o.displayName).join(", ") : "(No participants)");

  async function send(force = false) {
    const text = input.trim();
    if ((!text && pendingAtt.length === 0) || sending) return;
 // a draft contradicting the record gets stopped once. Force-send is the human's call.
    if (declined && !force) return;
    setSending(true);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": clientId },
        body: JSON.stringify({ text, attachments: pendingAtt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(`Failed to send: ${data?.error ?? res.status}`);
        return;
      }
 // dedupe by id — if the partner's refetch races the POST and delivers
 // this message first, no double bubble (or React key clash)
      setMessages((prev) => {
        const msg = data.message as DmMessage;
        return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
      });
      setInput("");
      setPendingAtt([]);
      setGuard(null);
      if (data.autoRun?.rootPageId) {
        setRoom((r) => (r ? { ...r, rootPageId: data.autoRun.rootPageId } : r));
      }
      void loadRooms(); // refresh sidebar previews/order
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const slots = MAX_ATTACHMENTS - pendingAtt.length;
    const picked = [...files].slice(0, slots);
    if (files.length > slots) show(`You can attach up to ${MAX_ATTACHMENTS} files`);
    setUploading(true);
    try {
      for (const file of picked) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          show(`Upload failed (${file.name}): ${data?.error ?? res.status}`);
          continue;
        }
        setPendingAtt((prev) => [...prev, { url: data.url as string, name: data.name as string }]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const agentMember = useMemo(() => members.find((m) => m.isAgent) ?? null, [members]);

  /** "saved 3m ago" — proof the agent is doing its job without it saying so. */
  const lastRecordedLabel = useMemo(() => {
    const stamps = messages
      .filter((m) => m.recordedAt)
      .map((m) => new Date(m.recordedAt as string).getTime())
      .filter((n) => Number.isFinite(n));
    if (!stamps.length) return null;
    const mins = Math.floor((Date.now() - Math.max(...stamps)) / 60_000);
    if (mins < 1) return "saved just now";
    if (mins < 60) return `saved ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return hrs < 24 ? `saved ${hrs}h ago` : `saved ${Math.floor(hrs / 24)}d ago`;
  }, [messages]);

  /** Mirrors the server's mention test — the draft decides which mode you send in. */
  const draftIsPrivate = useMemo(() => {
    if (!agentMember) return false;
    const t = input.toLowerCase();
    return t.includes("@agent") || t.includes(`@${agentMember.displayName.toLowerCase()}`);
  }, [input, agentMember]);

  /** Candidates for the "@" menu — the agent first, since mentioning it is how
   *  you ask the relationship a question, and nothing on screen says so. */
  const mentionCandidates = useMemo(() => {
    const list = members.filter((m) => m.id !== meId);
    return [...list].sort((a, b) => Number(b.isAgent) - Number(a.isAgent));
  }, [members, meId]);

  const mentionItems = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionCandidates.slice(0, 6);
    return mentionCandidates
      .filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) || (m.isAgent && "agent".includes(q))
      )
      .slice(0, 6);
  }, [mentionCandidates, mentionQuery]);

  /** Replace the "@query" under the caret with the picked handle. */
  function pickMention(user: DmUser) {
    if (mentionStart === null) return;
    const handle = user.isAgent ? "agent" : user.displayName.split(/\s+/)[0];
    const caret = composerRef.current?.selectionStart ?? input.length;
    const next = `${input.slice(0, mentionStart)}@${handle} ${input.slice(caret)}`;
    setInput(next);
    setMentionOpen(false);
    setMentionStart(null);
    const pos = mentionStart + handle.length + 2;
    requestAnimationFrame(() => {
      composerRef.current?.setSelectionRange(pos, pos);
      composerRef.current?.focus();
    });
  }

  function onInputChange(v: string) {
    setInput(v);
    // "@" at a word boundary opens the menu; whitespace in the query closes it.
    const caret = composerRef.current?.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const at = upto.lastIndexOf("@");
    const before = at > 0 ? upto[at - 1] : "";
    if (at === -1 || /\s/.test(upto.slice(at + 1)) || (before && !/\s/.test(before))) {
      setMentionOpen(false);
      setMentionStart(null);
    } else {
      setMentionQuery(upto.slice(at + 1));
      setMentionStart(at);
      setMentionIndex(0);
      setMentionOpen(true);
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > TYPING_PING_MS) {
      lastTypingSentRef.current = now;
      void fetch(`/api/dm/rooms/${roomId}/typing`, {
        method: "POST",
        headers: { "x-client-id": clientId },
      }).catch(() => {});
    }
  }

  async function commitRename() {
    setRenaming(false);
    const res = await fetch(`/api/dm/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      body: JSON.stringify({ name: renameDraft.trim() }),
    });
    if (res.ok) {
      const { room: next } = await res.json();
      setRoom((r) => (r ? { ...r, name: next.name } : r));
      void loadRooms();
    }
  }

  async function openInvite() {
    setInviteOpen((v) => !v);
    if (candidates) return;
    const res = await fetch("/api/workspace/members");
    if (!res.ok) return;
    const { members: all } = (await res.json()) as { members: DmUser[] };
    setCandidates(all);
  }

  async function invite(userId: string) {
    const res = await fetch(`/api/dm/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      show(`Invite failed: ${data?.error ?? res.status}`);
      return;
    }
    setInviteOpen(false);
    show(`Invited ${data.member?.displayName ?? "member"}`);
    void loadAll();
  }

  async function leave() {
    setConfirmLeave(false);
 // A consented room hosts a living agent — leaving it is a dissolution, and
 // dissolution mirrors birth: EVERY signer's wallet must sign RelationDissolve.
    const stRes = await fetch(`/api/dm/rooms/${roomId}/dissolve`);
    const st = stRes.ok ? await stRes.json() : null;
    if (st?.consentAt && !st.dissolvedAt) {
      if (st.mySigned) {
        const waiting = (st.parties as { displayName: string; signed: boolean }[])
          .filter((p) => !p.signed)
          .map((p) => p.displayName)
          .join(", ");
        show(`You already signed — waiting for ${waiting || "the other side"}`);
        return;
      }
      if (!st.canDissolve || !st.typedData) {
        show("Cannot leave: closing this relationship needs every signer's wallet");
        return;
      }
      try {
        const { signature } = await signTypedDataWithWallet(st.typedData);
        const res = await fetch(`/api/dm/rooms/${roomId}/dissolve`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-client-id": clientId },
          body: JSON.stringify({ signature }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          show(`Could not sign the dissolution: ${data?.error ?? res.status}`);
          return;
        }
        if (data.dissolvedAt) {
          show("Both signed — the relationship is closed. The record remains.");
          void loadRooms();
          router.push("/");
        } else {
          show(`Dissolution signed (${data.signed}/${data.required}) — waiting for the other side`);
        }
      } catch (err) {
        if (err instanceof WalletSignatureError && err.reason === "rejected") {
          show("Signature request was rejected.");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          show(`Signing failed: ${msg.slice(0, 140)}`);
        }
      }
      return;
    }
 // no agent yet — a plain leave needs no one's signature
    const res = await fetch(`/api/dm/rooms/${roomId}/members`, {
      method: "DELETE",
      headers: { "x-client-id": clientId },
    });
    if (!res.ok) {
      show("Could not leave the conversation");
      return;
    }
    void loadRooms();
    router.push("/");
  }

  /** Inviting the relationship agent = provisioning it (own key, A2A URL,
 * member tokens). Requires the signed contract (consentAt) upstream. */
  async function inviteAgent() {
    if (inviting) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/agent`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(`Agent invite failed: ${data?.error ?? res.status}`);
        return;
      }
      setHasAgent(true);
      show(data.alreadyExisted ? "That agent is already here" : "Relationship agent invited");
      void loadAll();
    } finally {
      setInviting(false);
    }
  }

  async function organize() {
    if (organizing) return;
    setOrganizing(true);
    try {
      const res = await fetch(`/api/agent/rooms/${roomId}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(`Could not organize: ${data?.error ?? res.status}`);
        return;
      }
      if (data.skipped) show("No new messages to organize");
      else show(`The agent organized ${data.processed} messages into the doc`);
      if (data.rootPageId) setRoom((r) => (r ? { ...r, rootPageId: data.rootPageId } : r));
      else void loadAll();
    } finally {
      setOrganizing(false);
    }
  }

  /** Make bare URLs in a message clickable (agent recs carry Google Maps links). */
  function linkify(text: string, mine: boolean) {
    // urls, plus bare 32-byte tx hashes — the on-chain registration notice
    // quotes one, and it is only useful if you can open it on the explorer.
    const parts = text.split(/(https?:\/\/[^\s<>"')\]]+|0x[0-9a-fA-F]{64})/g);
    if (parts.length === 1) return text;
    const linkClass = "underline underline-offset-2 text-[#2383e2] dark:text-blue-400";
    return parts.map((part, i) => {
      const isTx = /^0x[0-9a-fA-F]{64}$/.test(part);
      if (!isTx && !/^https?:\/\//.test(part)) return part;
      return (
        <a
          key={i}
          href={isTx ? `${EXPLORER_BASE}/tx/${part}` : part}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
          title={isTx ? part : undefined}
        >
          {isTx ? `${part.slice(0, 10)}…${part.slice(-8)}` : part}
        </a>
      );
    });
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-500" data-testid="dm-error">
          {error}
        </p>
      </div>
    );
  }

  const typingNames = Object.values(typing).map((t) => t.name);
  const inviteCandidates = (candidates ?? []).filter(
    (u) => !members.some((m) => m.id === u.id)
  );

  return (
    // min-h-0: without it the transcript can outgrow this column, the shared
    // <main> scrolls instead of the list, and the composer rides away with it.
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        variant === "call" ? "px-3" : "mx-auto max-w-3xl px-3 sm:px-6"
      }`}
    >
      {/* Header — leave room on the left so the fixed mobile hamburger (MobileNavToggle) does not overlap */}
      {variant !== "call" && (
      <header className="group flex items-center gap-2 border-b border-neutral-200/80 py-3 pl-10 sm:gap-2.5 sm:py-3.5 sm:pl-0 dark:border-neutral-800">
        <div className="flex -space-x-2" data-testid="dm-members" aria-label="Room members">
          {/* humans lead the stack; the agent tags along at the end */}
          {[...members]
            .sort((a, b) => Number(a.isAgent) - Number(b.isAgent))
            .slice(0, 4)
            .map((m) => (
              <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-neutral-950">
                <DmAvatar user={m} size={28} />
              </span>
            ))}
        </div>

        {renaming ? (
          <input
            ref={renameRef}
            data-testid="dm-rename-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              else if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={() => void commitRename()}
            className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-sm font-semibold outline-none ring-1 ring-blue-400 dark:bg-neutral-900"
          />
        ) : (
          <>
            <h1
              data-testid="dm-room-title"
              className="min-w-0 truncate text-[15px] font-semibold text-neutral-800 dark:text-neutral-100"
            >
              {loading ? "…" : title}
            </h1>
            <button
              data-testid="dm-rename"
              aria-label="Rename room"
              data-tip="Rename"
              onClick={() => {
                setRenameDraft(room?.name ?? "");
                setRenaming(true);
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-800"
            >
              <Pencil size={14} />
            </button>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <CallButton roomId={roomId} />
          {/* One chip for the agent: that it is here, when it last wrote, and
              the way into the record. It reads as presence, not as a feature. */}
          {room?.rootPageId && (
            <Link
              data-testid="dm-doc-link"
              href={`/p/${room.rootPageId}`}
              aria-label="Open relationship doc"
              data-tip="Everything the two of you have recorded"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 sm:px-2.5 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <FileText size={14} />
              <span className="hidden font-medium text-neutral-700 sm:inline dark:text-neutral-200">
                Record
              </span>
              {lastRecordedLabel && (
                <span className="hidden text-neutral-400 sm:inline">· {lastRecordedLabel}</span>
              )}
            </Link>
          )}
          {hasAgent === false && (
            <button
              data-testid="dm-invite-agent"
              onClick={() => void inviteAgent()}
              disabled={inviting}
              data-tip="Invite an agent that remembers this relationship"
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 sm:px-2.5 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Bot size={14} />{" "}
              <span className="hidden sm:inline">{inviting ? "Inviting…" : "Invite agent"}</span>
            </button>
          )}
          {/* Filing happens on its own; this is the manual nudge, so it earns an
              icon rather than a coloured button competing with the room title. */}
          <button
            data-testid="dm-organize"
            onClick={() => void organize()}
            disabled={organizing}
            aria-label="Ask the agent to file the conversation now"
            data-tip={organizing ? "Filing…" : "File the conversation now"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Sparkles size={14} className={organizing ? "animate-pulse" : ""} />
          </button>

          <div className="relative">
            <button
              data-testid="dm-invite"
              aria-label="Invite people"
              data-tip="Invite people"
              onClick={() => void openInvite()}
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-neutral-100 hover:text-neutral-600 active:scale-90 dark:hover:bg-neutral-800"
            >
              <UserPlus size={16} />
            </button>
            {inviteOpen && (
              <div
                data-testid="dm-invite-popover"
                className="popover-anim absolute right-0 top-8 z-50 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
              >
                {candidates === null ? (
                  <p className="px-2 py-2 text-xs text-neutral-400">Loading…</p>
                ) : inviteCandidates.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-neutral-400" data-testid="dm-invite-empty">
                    No one left to invite.
                  </p>
                ) : (
                  inviteCandidates.map((u) => (
                    <button
                      key={u.id}
                      data-testid={`dm-invite-option-${u.id}`}
                      onClick={() => void invite(u.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <DmAvatar user={u} size={20} />
                      <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              data-testid="dm-leave"
              aria-label="Leave room"
              data-tip="Leave conversation"
              onClick={() => setConfirmLeave((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-red-50 hover:text-red-600 active:scale-90 dark:hover:bg-red-950/40"
            >
              <LogOut size={16} />
            </button>
            {confirmLeave && (
              <div className="popover-anim absolute right-0 top-8 z-50 w-52 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">
                  Leave this conversation? If the agent has been born, closing it
                  takes both signatures — your wallet will ask first.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    data-testid="dm-leave-cancel"
                    onClick={() => setConfirmLeave(false)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="dm-leave-confirm"
                    onClick={() => void leave()}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Leave
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      )}

      {variant !== "call" && (
        <>
          <ConsentBanner roomId={roomId} />
          <DissolveBanner roomId={roomId} />
        </>
      )}

      {/* Message list */}
      <div
        data-testid="dm-messages"
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto py-4"
      >
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 w-2/3 animate-pulse rounded-lg bg-neutral-200/70 dark:bg-neutral-800" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400" data-testid="dm-empty">
            No messages yet — say hello 👋
          </p>
        ) : (
          messages.map((m, i) => {
            const mine = m.authorId === meId;
            const author = userById.get(m.authorId);
            const prev = messages[i - 1];
            const newDay =
              !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped =
              !newDay && prev?.authorId === m.authorId &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
            // "📞 " prefix = a call record the calls route inserted — rendered
            // as a KakaoTalk-style event bubble instead of a text bubble
            const callEvent =
              !m.privateToUserId && (m.attachments?.length ?? 0) === 0 && m.text.startsWith("📞 ")
                ? (() => {
                    const [label, duration] = m.text.slice(3).split(" · ");
                    return { label, duration, missed: label.startsWith("Missed") };
                  })()
                : null;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                    <span className="text-[11px] text-neutral-400">{dateLabel(m.createdAt)}</span>
                    <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                  </div>
                )}
                <div
                  data-testid={mine ? "dm-msg-mine" : "dm-msg-other"}
                  className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
                >
                  {!mine && (
                    // top-aligned so the face sits beside the sender name,
                    // not dangling at the bubble's bottom edge
                    <span className="w-7 shrink-0 self-start">
                      {!grouped && author && <DmAvatar user={author} size={26} />}
                    </span>
                  )}
                  {/* min-w-0: a long unbreakable token (the agent loves /p/… paths)
                      sets a huge min-content and the flex item refuses to shrink —
                      the bubble then runs past the panel instead of wrapping */}
                  <div className={`flex min-w-0 max-w-[76%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine && !grouped && (
                      <p className="mb-1 px-1 text-[11px] font-medium text-neutral-500">
                        {author?.displayName ?? "Unknown"}
                      </p>
                    )}
                    {callEvent ? (
                      <div
                        data-testid="dm-msg-call"
                        className="flex min-w-[176px] items-center gap-2.5 rounded-lg bg-neutral-50 px-3 py-2.5 text-[14px] ring-1 ring-neutral-200/70 dark:bg-neutral-800/50 dark:ring-neutral-700/60"
                      >
                        {callEvent.missed ? (
                          <PhoneMissed size={16} className="shrink-0 text-orange-500" />
                        ) : (
                          <Phone
                            size={16}
                            className={`shrink-0 ${
                              callEvent.duration
                                ? "text-neutral-500 dark:text-neutral-300"
                                : "text-green-600"
                            }`}
                          />
                        )}
                        <div className="flex-1 text-right">
                          <p className="text-[13px] font-medium">{callEvent.label}</p>
                          {callEvent.duration && (
                            <p className="text-[12px] text-neutral-500">{callEvent.duration}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                    <div
                      className={`rounded-lg px-3 py-2 text-[14px] leading-relaxed ${
                        mine
                          ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                          : "bg-neutral-50 text-neutral-800 ring-1 ring-neutral-200/70 dark:bg-neutral-800/50 dark:text-neutral-100 dark:ring-neutral-700/60"
                      }`}
                    >
                      {m.attachments?.length > 0 && (
                        <div className={`flex flex-wrap gap-1.5 ${m.text ? "mb-1.5" : ""} pt-1`}>
                          {m.attachments.map((a) => (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                data-testid="dm-msg-image"
                                src={a.url}
                                alt={a.name}
                                className="max-h-56 max-w-full rounded-lg object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      {m.text && (
                        <p
                          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
                          data-testid="dm-msg-text"
                        >
                          {linkify(m.text, mine)}
                        </p>
                      )}
                      {m.recordedAt && !m.privateToUserId && (
                        <Link
                          href={room?.rootPageId ? `/p/${room.rootPageId}` : "#"}
                          data-testid="dm-msg-recorded"
                          className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          <Sparkles size={10} />
                          Added to your record
                        </Link>
                      )}
                      {m.privateToUserId && (
                        <p
                          data-testid="dm-msg-private"
                          className="mt-1 flex items-center gap-1 text-[10px] text-neutral-400"
                        >
                          <Lock size={10} />
                          Quiet · only you and the agent — not in your shared record
                        </p>
                      )}
                    </div>
                    )}
                  </div>
                  <span className={`shrink-0 pb-0.5 text-[10px] text-neutral-400 ${mine ? "order-first" : ""}`}>
                    {timeLabel(m.createdAt)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {typingNames.length > 0 && (
          <div data-testid="dm-typing" className="flex items-center gap-2 px-8 pt-1">
            <span className="flex gap-0.5">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
            <span className="text-xs text-neutral-400">{typingNames.join(", ")} is typing…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending attachments */}
      {pendingAtt.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          {pendingAtt.map((a) => (
            <span
              key={a.url}
              data-testid="dm-attachment-chip"
              className="relative inline-block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="h-14 w-14 rounded-md object-cover" />
              <button
                aria-label={`Remove ${a.name}`}
                data-testid="dm-attachment-remove"
                onClick={() => setPendingAtt((prev) => prev.filter((x) => x.url !== a.url))}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-white hover:bg-neutral-900"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Composer */}
      {declined && (
        <div
          data-testid="dm-guard-card"
          className="mx-3 mb-2 space-y-1.5 rounded-lg border border-amber-300/80 bg-amber-50 p-3 text-xs dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <div className="font-medium text-amber-800 dark:text-amber-300">⚠️ This conflicts with the record</div>
          <p className="text-neutral-700 dark:text-neutral-300">{guard?.reason}</p>
          {guard?.evidence?.map((e, i) => (
            <p key={i} className="text-neutral-500">
              Evidence [{e.section}] “{e.quote}”
            </p>
          ))}
          {guard?.suggestion && (
            <p className="text-neutral-700 dark:text-neutral-300">Suggested fix: {guard.suggestion}</p>
          )}
          <button
            type="button"
            data-testid="dm-guard-force"
            onClick={() => void send(true)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:bg-white dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            Send anyway
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="relative flex items-end gap-2 border-t border-neutral-200/80 pb-3 pt-7 dark:border-neutral-800"
      >
        {mentionOpen && mentionItems.length > 0 && (
          <div
            data-testid="dm-mention-menu"
            role="listbox"
            className="absolute bottom-full left-11 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            {mentionItems.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                data-testid={`dm-mention-item-${u.id}`}
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(u);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  i === mentionIndex
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                }`}
              >
                <DmAvatar user={u} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-neutral-800 dark:text-neutral-200">
                    @{u.isAgent ? "agent" : u.displayName.split(/\s+/)[0]}
                  </span>
                  {u.isAgent && (
                    <span className="block truncate text-[11px] text-neutral-400">
                      Ask quietly — answers from your record, just to you
                    </span>
                  )}
                </span>
                {u.isAgent && (
                  <span className="shrink-0 rounded bg-purple-100 px-1 text-[10px] text-purple-600 dark:bg-purple-900/40 dark:text-purple-300">
                    AGENT
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* Which mode this draft will send in. The rule is invisible otherwise:
            a mention makes it private, anything else is on the shared record. */}
        <div
          data-testid="dm-compose-mode"
          className="pointer-events-none absolute -top-0.5 left-11 flex items-center gap-1.5 text-[11px] text-neutral-400"
        >
          {draftIsPrivate ? (
            <>
              <Lock size={11} className="text-neutral-500 dark:text-neutral-400" />
              <span className="text-neutral-500 dark:text-neutral-400">
                Quiet — only you and the agent
              </span>
            </>
          ) : (
            <span>
              {others.length === 1 ? `Shared with ${others[0].displayName.split(/\s+/)[0]}` : "Shared with the room"}
              {agentMember ? " · the agent may add it to your record" : ""}
            </span>
          )}
        </div>
        <input
          ref={fileRef}
          data-testid="dm-attach-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
        <button
          type="button"
          data-testid="dm-attach"
          aria-label="Attach image"
          data-tip="Attach a photo"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-all hover:bg-neutral-100 hover:text-neutral-600 active:scale-90 disabled:opacity-50 dark:hover:bg-neutral-800"
        >
          <ImagePlus size={18} />
        </button>
        <textarea
          ref={composerRef}
          data-testid="dm-composer-input"
          value={input}
          rows={1}
          placeholder="Type a message…"
          onChange={(e) => onInputChange(e.target.value)}
          onCompositionStart={() => (isComposingRef.current = true)}
          onCompositionEnd={() => (isComposingRef.current = false)}
          onKeyDown={(e) => {
            // the mention menu owns the arrows/Enter/Esc while it is open
            if (mentionOpen && mentionItems.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !isComposingRef.current) {
                e.preventDefault();
                pickMention(mentionItems[mentionIndex]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionOpen(false);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
              e.preventDefault();
              void send();
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
        />
        <button
          type="submit"
          data-testid="dm-send"
          aria-label="Send message"
          disabled={sending || uploading || (!input.trim() && pendingAtt.length === 0)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2383e2] text-white transition-colors hover:bg-[#1b6fc0] active:scale-95 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
