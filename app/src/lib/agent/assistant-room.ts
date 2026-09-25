/** A person's own assistant room (the round agent button): one person, one
 *  agent. It keeps no relationship document — there is no relationship. */
export const ASSISTANT_ROOM = "에이전트";

export function isAssistantRoom(room: { kind: string; name: string }): boolean {
  return room.kind === "agent" && room.name === ASSISTANT_ROOM;
}
