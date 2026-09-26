import { ASSISTANT_ROOM_NAME } from "@/i18n/content/agent";

/** A person's own assistant room (the round agent button): one person, one
 *  agent. It keeps no relationship document — there is no relationship. */
export const ASSISTANT_ROOM = ASSISTANT_ROOM_NAME;

export function isAssistantRoom(room: { kind: string; name: string }): boolean {
  return room.kind === "agent" && room.name === ASSISTANT_ROOM;
}
