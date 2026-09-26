import type { DmUser } from "@/stores/dm-rooms";

/** The room message as GET /api/dm/rooms/{id} returns it — structurally the
 *  same as dm-view's DmMessage, so the parent passes its array as is. */
export interface RoomChatAttachment {
  url: string;
  name: string;
}

export interface RoomChatMessage {
  id: string;
  authorId: string;
  text: string;
  attachments: RoomChatAttachment[];
  createdAt: string;
  /** set on a private exchange with the agent — only this member ever sees it */
  privateToUserId?: string | null;
  /** set once the agent folded this message into the shared record */
  recordedAt?: string | null;
}

/** The pre-send fact check's "decline" verdict (POST /api/agent/rooms/{id}/guard). */
export interface RoomChatGuardNotice {
  reason?: string;
  suggestion?: string;
  evidence?: { section: string; quote: string }[];
}

/** The "@" member menu. The parent owns detection and insertion (dm-view's
 *  onInputChange / pickMention); this is only what the menu needs to draw. */
export interface RoomChatMention {
  open: boolean;
  items: DmUser[];
  index: number;
  setIndex: (index: number) => void;
  pick: (user: DmUser) => void;
  close: () => void;
}
