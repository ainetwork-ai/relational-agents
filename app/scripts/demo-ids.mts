// Fixed ids for the presenter's copy of the Tokyo Trip demo (seed-tokyo-trip.mts --mine), shared
// with scripts/demo-contributions.mts: contribution plans are named by salts built from the room's
// and the members' ids, so every server that runs the seed must give them the same ids.
import { createHash } from "node:crypto";

/** a uuid-shaped id fixed by `name` */
export function stableId(name: string): string {
  const h = createHash("sha256").update(`ainmem-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const MINE_ROOM_ID = stableId("mine:room");
export const mineFriendId = (key: "bea" | "chris" | "dana" | "eli") => stableId(`mine:${key}`);
