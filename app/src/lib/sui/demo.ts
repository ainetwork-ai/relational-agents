/**
 * Ground truth for the /sui judge page.
 *
 * Every id, digest and error string here was produced by the scripted runs in
 * `sui/scripts/` and is recorded verbatim in `sui/lifecycle.json` and
 * `sui/walrus-seal.json`. Nothing in this file is illustrative; if a value
 * changes it is because the chain changed and the receipts must be re-run.
 */

export const PACKAGE_ID =
  "0xfd759330549d6135cf85ca03786ca25c79d053b0167695d32f8df95bbcf5d8e4";

/** The relationship holding the Seal-encrypted note and photo. Still active. */
export const SEALED_AGENT_ID =
  "0xd93bdd24a0e89cdbb25d6ac1b0e8b38ecff6d694ba193386d9825a80429d7837";

/** The relationship that was run end to end, including dissolve. */
export const LIFECYCLE_AGENT_ID =
  "0x47694faf5169cafb74c4d2124a251d2f4597611d319b014dfeeb0a03015f9933";

/** A second, unrelated relationship — the one whose member is still refused. */
export const SECOND_AGENT_ID =
  "0xe80fa259f7910a17709080ef005f48aa3202ad3e4da54c677c9567a6928c03ee";

export const MEMBER_A =
  "0xe3a7f4fd23b8d109638dc1106d29e16c6e6501f3a6fb77183a779b0b3c59dd69";
export const MEMBER_B =
  "0x28988cf3cf57057986de90646ef7cbb4e3f39d821a17bc2de9b459dc69bd0784";
export const OUTSIDER =
  "0x01e00816dd8dd96c9d1eb8480e2ebbfbb534019d70d6e6b2efc8e081298d5dc8";

/**
 * The demo cast, mapped onto the keypairs the scripted run actually used.
 *
 * The scripts signed with three throwaway ed25519 keys; these are the demo
 * characters those keys stand for, so the page can tell the same story the
 * product tells (memory-data seeds the rooms "Hannah ❤️ Chanho" and
 * "Ava ❤️ Chanho"). The addresses are unchanged — only the labels are ours.
 */
export const CHANHO = { name: "Chanho", address: MEMBER_A };
export const HANNAH = { name: "Hannah", address: MEMBER_B };
export const AVA = { name: "Ava", address: OUTSIDER };

/** The two rooms the demo runs in, titled the way the app titles them. */
export const ROOM_SEALED = "Hannah ❤️ Chanho";
export const ROOM_OTHER = "Ava ❤️ Chanho";

/** The photo that was sealed — byte-identical to what the scripts encrypted. */
export const PHOTO_SRC = "/egg-tart.jpg";

export const NOTE_BLOB_ID = "F03E3p4ljJxb4LzAuQ-_R6h3cAdU5y1uWZLhQ_q6NiM";
export const PHOTO_BLOB_ID = "8vhW7Qwa3VeXjh-vJ7YipqP-cQfiFYiSl_4ro-3hGpQ";

export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

export function walrusBlobUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
}

export function suiscanObject(id: string): string {
  return `https://suiscan.xyz/testnet/object/${id}`;
}

export function suiscanTx(digest: string): string {
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}

/** What the note actually says, once a member's key servers release the shares. */
export const NOTE_PLAINTEXT_PREVIEW =
  "# The egg tart\n\nWe walked past the bakery twice before going in. She said the crust\nwas better than the one in Lisbon; he disagreed, loudly, and then ate\ntwo.";

export const PLAINTEXT_MARKER = "egg tart";

/** The `seal_approve` predicate, verbatim from sui/move/sources/relational_agent.move. */
export const SEAL_APPROVE_SOURCE = `/// The Seal policy. Key servers dry-run this before deriving the key for
/// identity \`id\`; an abort means "no key". Two conditions: the requester is a
/// member of this relationship, and the identity actually belongs to this
/// object, so a member of relationship X cannot unlock relationship Y's blob.
entry fun seal_approve(id: vector<u8>, agent: &RelationalAgent, ctx: &TxContext) {
    assert!(agent.members.contains(&ctx.sender()), ENotMember);
    assert!(is_prefix(object::id(agent).to_bytes(), id), EPolicyMismatch);
}`;

export interface LifecycleEvent {
  label: string;
  detail: string;
  digest?: string;
  outcome: "ok" | "rejected";
}

/** From sui/lifecycle.json — the whole life of one relationship on chain. */
export const LIFECYCLE: LifecycleEvent[] = [
  {
    label: "create",
    detail: "Two addresses, one shared object. Neither member owns it alone.",
    digest: "CApTfpV3AyxVqAPfVDtKUzPsLcyuVH7fCYtc5mB9h6Jh",
    outcome: "ok",
  },
  {
    label: "add_memory · member",
    detail: "A member appends a blob id. Accepted.",
    digest: "2L2C2sC5fCh1Zp8HgpGERpHKLB8rfBNNCHrbSVzxGqEX",
    outcome: "ok",
  },
  {
    label: "add_memory · non-member",
    detail:
      "A third address tries to write to someone else's relationship. The chain aborts with ENotMember (code 2) — not our server, the chain.",
    outcome: "rejected",
  },
  {
    label: "dissolve",
    detail:
      "A member ends it. The object is not deleted: dissolved_at_ms is stamped and the record outlives the relationship.",
    digest: "5qoWR4Hdb5Ecr1bondefrVPgoa4SnESwR5g67TgQNMMp",
    outcome: "ok",
  },
];

export interface SealOutcome {
  who: string;
  role: string;
  asks: string;
  verdict: string;
  detail: string;
  allowed: boolean;
}

/** From sui/walrus-seal.json — the three recorded decryption attempts. */
export const SEAL_OUTCOMES: SealOutcome[] = [
  {
    who: "Chanho",
    role: `In ${ROOM_SEALED}`,
    asks: "the egg tart note, from his own room",
    verdict: "Opens · 219 bytes, byte-identical",
    detail:
      "The key servers dry-run seal_approve, find his address in members, and release their shares. matchesOriginal: true. The photo comes back with its JPEG magic intact (ffd8ffe0…JFIF).",
    allowed: true,
  },
  {
    who: "Ava",
    role: "Not in this relationship",
    asks: "the same note",
    verdict: "Refused · NoAccessError",
    detail:
      '"User does not have access to one or more of the requested keys." Refused by the Seal key servers, before any byte is handed over.',
    allowed: false,
  },
  {
    who: `Chanho, via ${ROOM_OTHER}`,
    role: "A member — of the other relationship",
    asks: "the same note, presenting the Ava agent",
    verdict: "Refused · NoAccessError",
    detail:
      "This is the demo's whole point, enforced by a chain instead of by us. Chanho is legitimately a member here too, but seal_approve binds the identity to one object id — so the agent he shares with Ava cannot open the memory he made with Hannah.",
    allowed: false,
  },
];

export const REPRO_COMMAND =
  "node sui/scripts/walrus-seal.mjs --sui <path/to/sui> --config <client.yaml> \\\n  --package 0xfd759330549d6135cf85ca03786ca25c79d053b0167695d32f8df95bbcf5d8e4";

/**
 * Testnet JSON-RPC endpoints, tried in order. The canonical fullnode is first;
 * the others are there because a hackathon demo that dies on one provider's
 * rate limit is not a demo.
 */
const RPC_ENDPOINTS = [
  "https://fullnode.testnet.sui.io:443",
  "https://rpc-testnet.suiscan.xyz",
  "https://sui-testnet-rpc.publicnode.com",
];

export interface AgentMemory {
  blobId: string;
  kind: string;
  createdAtMs: string;
}

export interface AgentObject {
  objectId: string;
  version: string;
  digest: string;
  previousTransaction: string;
  sharedAtVersion: string | null;
  members: string[];
  status: number;
  createdAtMs: string;
  dissolvedAtMs: string;
  memories: AgentMemory[];
}

interface RpcFields {
  id?: { id?: string };
  members?: { fields?: { contents?: string[] } };
  status?: number | string;
  created_at_ms?: string;
  dissolved_at_ms?: string;
  memories?: { fields?: { blob_id?: string; kind?: string; created_at_ms?: string } }[];
}

function parseAgent(data: {
  objectId?: string;
  version?: string;
  digest?: string;
  previousTransaction?: string;
  owner?: { Shared?: { initial_shared_version?: number | string } };
  content?: { fields?: RpcFields };
}): AgentObject | null {
  const f = data.content?.fields;
  if (!f) return null;
  return {
    objectId: data.objectId ?? "",
    version: String(data.version ?? ""),
    digest: data.digest ?? "",
    previousTransaction: data.previousTransaction ?? "",
    sharedAtVersion:
      data.owner?.Shared?.initial_shared_version != null
        ? String(data.owner.Shared.initial_shared_version)
        : null,
    members: f.members?.fields?.contents ?? [],
    status: Number(f.status ?? 0),
    createdAtMs: String(f.created_at_ms ?? "0"),
    dissolvedAtMs: String(f.dissolved_at_ms ?? "0"),
    memories: (f.memories ?? []).map((m) => ({
      blobId: m.fields?.blob_id ?? "",
      kind: m.fields?.kind ?? "",
      createdAtMs: String(m.fields?.created_at_ms ?? "0"),
    })),
  };
}

export interface LiveAgent {
  agent: AgentObject | null;
  endpoint: string | null;
  error: string | null;
  fetchedAt: number;
}

/**
 * Read a RelationalAgent straight off Sui testnet. Plain JSON-RPC over fetch —
 * no SDK, so the page carries no wallet bundle and cannot drift from what a
 * judge would see running the same curl.
 */
export async function fetchAgent(objectId: string): Promise<LiveAgent> {
  let lastError = "no endpoint responded";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sui_getObject",
          params: [
            objectId,
            { showContent: true, showOwner: true, showPreviousTransaction: true },
          ],
        }),
        next: { revalidate: 30 },
      });
      if (!res.ok) {
        lastError = `${endpoint} → HTTP ${res.status}`;
        continue;
      }
      const body = await res.json();
      const agent = parseAgent(body?.result?.data ?? {});
      if (!agent) {
        lastError = `${endpoint} → object had no content`;
        continue;
      }
      return { agent, endpoint, error: null, fetchedAt: Date.now() };
    } catch (err) {
      lastError = `${endpoint} → ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { agent: null, endpoint: null, error: lastError, fetchedAt: Date.now() };
}

export function formatMs(ms: string): string {
  const n = Number(ms);
  if (!n) return "—";
  return new Date(n).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 2) return id;
  return `${id.slice(0, head + 2)}…${id.slice(-tail)}`;
}
