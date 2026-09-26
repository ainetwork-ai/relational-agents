import type { TreasuryStatus } from "@/lib/agent/treasury/types";

/** One person (or the room's agent) as the Treasury page names them. */
export interface TreasuryRoomPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

/** GET /api/treasury/[roomId] — what /treasury/[roomId] renders. */
export interface TreasuryRoomResponse {
  status: TreasuryStatus;
  /** members in join order, then the room's agents */
  room: { id: string; name: string; members: TreasuryRoomPerson[] };
  me: { id: string; displayName: string };
}

export type TreasuryAction = TreasuryStatus["actions"][number];
export type RecurringLive = NonNullable<NonNullable<TreasuryStatus["recurring"]>["live"]>;
export type RecurringPending = NonNullable<NonNullable<TreasuryStatus["recurring"]>["pending"]>;
export type RecurringRun = NonNullable<TreasuryStatus["recurring"]>["history"][number];
