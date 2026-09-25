/**
 * Relation Treasury — the shared contract.
 *
 * A room's Relation Agent manages the relation's shared wallet. What it may do
 * is not configured in a settings screen: it is written in the relation's own
 * memory doc (OKF) as plain bullet rules, which the agent reads, cites, and a
 * deterministic evaluator enforces. The model classifies nothing that moves
 * money — commands are matched by sentence shape (match.ts), rules are parsed
 * by grammar (policy.ts), quorums are counted by SQL (approvals.ts).
 *
 * Two World ID surfaces, each at its own trust moment:
 *   - IDKit (action TREASURY_SEAT_ACTION, signal = roomId): claiming a SEAT —
 *     the right to approve. Proof of Human, once per member. One human, one
 *     seat: a second account of the same person yields the same nullifier.
 *   - World ID for Agents (sandbox OIDC IdP, pairwise `sub`): every APPROVAL of
 *     a critical agent action is a fresh step-up (max_age=0; auth_time/iat must
 *     postdate the action). Quorum = count of DISTINCT subs on that action.
 *
 * Module map (each file owned by one builder; import only through these names):
 *   policy.ts     parseTreasuryPolicy(), parsePayees(), evaluateCommand()  (pure)
 *   match.ts      matchTreasuryCommand()                                  (pure)
 *   memory.ts     loadRelationTreasury(), appendTreasuryActivity()        (OKF io)
 *   wallet.ts     ensureAgentWallet(), treasuryBalance(), fundTreasury(),
 *                 transferUsd(), usdToEth(), ethToUsd()                   (chain io)
 *   approvals.ts  createTreasuryAction(), recordIdpApproval(), claimSeat(),
 *                 executeIfQuorum(), treasuryStatus()                     (db)
 *   skill.ts      handleTreasuryCommand()  — called from respond.ts
 */

/** IDKit action for claiming a seat (register in the Developer Portal). */
export const TREASURY_SEAT_ACTION = process.env.WORLD_ID_SEAT_ACTION ?? "treasury-seat";

// ── rules (from the memory doc) ─────────────────────────────────────────────

export type TreasuryKind = "expense" | "investment" | "withdrawal";

/**
 * One bullet of the doc's "Treasury Rules" section, parsed. Grammar (English,
 * case-insensitive; one rule per bullet; "$" amounts in USD):
 *
 *   - Shared expenses under $50: the agent may pay on its own.
 *   - Shared expenses from $50 to $200: 2 verified members approve.
 *   - Shared expenses over $200: 3 verified members approve.
 *   - Investing idle funds: 3 verified members approve.
 *   - Moving more than 30% of the treasury at once: 4 verified members approve.
 *   - Sending treasury money to a member's personal wallet: not allowed.
 *
 * Subject → kind: "expense(s)" → expense · "invest…" → investment ·
 * "withdraw…" / "personal wallet" → withdrawal · "moving…/any…" → any.
 * Amount → [minUsd, maxUsd): "under $X" [0,X) · "from $X to $Y" [X,Y] (Y
 * inclusive, stored as Y+0.000001) · "over $X" (X,∞) · absent → [0,∞).
 * "more than N% of the treasury" → minSharePct N (applies when
 * amount/balance*100 > N). "personal wallet" → personal: true.
 * Outcome: "may pay on its own" → approvals 0 · "N verified members approve" →
 * approvals N · "not allowed" → forbidden. A bullet that does not parse is
 * reported in `unparsed` — never guessed at.
 */
export interface TreasuryRule {
  /** the bullet, verbatim (without the leading "- ") — what the agent cites */
  text: string;
  kind: TreasuryKind | "any";
  minUsd: number;
  maxUsd: number;
  minSharePct?: number;
  /** applies only to money going to a member's own wallet */
  personal?: boolean;
  /** approvals required; 0 = the agent may execute on its own */
  approvals: number;
  forbidden?: boolean;
}

export interface TreasuryPolicy {
  rules: TreasuryRule[];
  /** bullets that did not parse — surfaced, and the policy is then fail-closed */
  unparsed: string[];
}

/** Payees the relation agreed on: "- Hotel Gracery Shinjuku: 0xabc…" */
export interface Payee {
  name: string;
  address: `0x${string}`;
}

// ── commands (from chat) ────────────────────────────────────────────────────

/**
 * What a chat message asks the agent to do with the treasury. Only produced
 * when the message is addressed to the agent AND matches a money sentence:
 *   "@agent pay the hotel deposit, $180"                 expense, payee "hotel"
 *   "@agent book the hotel for $180"                     expense
 *   "@agent send $700 to my wallet"                      withdrawal, toSelf
 *   "@agent invest $300 of the idle funds"               investment
 *   "@agent what's our balance?" / "treasury status"      kind "status"
 */
export type TreasuryCommand =
  | {
      kind: TreasuryKind;
      amountUsd: number;
      /** what it is for / who gets paid, as said ("hotel deposit") */
      memo: string;
      /** money goes to the speaker's own wallet */
      toSelf: boolean;
      raw: string;
    }
  | { kind: "status"; raw: string };

// ── evaluation ──────────────────────────────────────────────────────────────

export type TreasuryDecision =
  /** within what the agent may do alone */
  | { outcome: "auto"; rule: TreasuryRule }
  /** allowed, once `required` distinct verified humans approve */
  | { outcome: "approval"; required: number; rule: TreasuryRule; applied: TreasuryRule[] }
  /** the relation's rules forbid it — refused without asking anyone */
  | { outcome: "forbidden"; rule: TreasuryRule | null; reason: string; applied: TreasuryRule[] }
  /** more than the treasury holds */
  | { outcome: "insufficient"; balanceUsd: number };

export interface EvaluateInput {
  policy: TreasuryPolicy;
  kind: TreasuryKind;
  amountUsd: number;
  personal: boolean;
  balanceUsd: number;
}

// ── the relation's memory, as the treasury sees it ──────────────────────────

export interface RelationTreasury {
  roomId: string;
  policy: TreasuryPolicy;
  payees: Payee[];
  /** the doc's "Purpose" section as plain text ("" if none) */
  purpose: string;
  /** /p/<id> of the rules section, for links in agent messages */
  rulesPageId: string | null;
  /** OKF rel path of the "Treasury Activity" section (created on first append) */
  activityPath: string | null;
}

// ── status (GET /api/dm/rooms/[roomId]/treasury) ────────────────────────────

export interface TreasuryStatus {
  enabled: boolean;
  address: string | null;
  balanceUsd: number | null;
  /** ETH on Sepolia behind balanceUsd, and the demo scale used */
  balanceEth: string | null;
  usdPerEth: number;
  purpose: string;
  rulesPageId: string | null;
  rules: string[];
  members: {
    userId: string;
    displayName: string;
    seated: boolean;
    seatLevel: string | null;
    /** has completed a World ID for Agents step-up at least once */
    worldVerified: boolean;
  }[];
  mySeated: boolean;
  actions: {
    id: string;
    kind: TreasuryKind;
    amountUsd: number;
    memo: string;
    status: "pending" | "executed" | "blocked" | "failed" | "cancelled";
    requiredApprovals: number;
    ruleText: string;
    requestedBy: { userId: string; displayName: string };
    approvals: { userId: string; displayName: string; at: string }[];
    txHash: string | null;
    error: string | null;
    createdAt: string;
    /** can the viewer approve right now (seated, not yet approved, pending) */
    canApprove: boolean;
  }[];
  /** IDKit seat claim: "world-id" needs NEXT_PUBLIC_WORLD_ID_APP_ID + rpContext */
  seatMode: "world-id" | "dev-simulator";
  seatAction: string;
  rpContext: Record<string, unknown> | null;
  /** where the step-up goes: "sandbox" | "mock" | null (IdP not configured) */
  idpMode: "sandbox" | "mock" | null;
}

/** Result of an approval arriving (OIDC callback → recordIdpApproval). */
export type ApprovalResult =
  | { ok: true; approvals: number; required: number; executed: boolean; txHash?: string | null }
  | {
      ok: false;
      reason:
        | "not-found"
        | "not-pending"
        | "not-member"
        | "not-seated"
        | "stale-proof"
        | "same-human"
        | "already-approved"
        | "requester-excluded";
      message: string;
    };

export type SeatResult =
  | { ok: true; level: string }
  | { ok: false; reason: "same-human" | "not-member" | "proof-rejected"; message: string };
