/**
 * A relationship profile — what kind of relationship this agent serves.
 *
 * Not every relationship is a romance. Two colleagues want agreements and
 * action items, not a timeline of dates; a question asked out loud on a sales
 * call is not the same event as one asked over dinner. The agent's machinery
 * is the same either way, so what differs is gathered here: the sections the
 * record is kept in, the vocabulary the prompts speak, and which of the coded
 * rules apply.
 *
 * Built-in profiles live beside this file as plain objects, versioned with the
 * app. A room picks one (agentConfig.profile) and may override individual
 * settings on top. Nothing here is read from user input, so a profile cannot
 * arrive malformed — when that changes, validate at the resolve boundary and
 * fall back to the default rather than letting a bad profile stop the agent.
 */

/** One section file of the relationship document. `key` is the identity that
 *  survives a profile change — agent_room_states maps it to a file path, so a
 *  key kept between profiles keeps its history and only changes its label. */
export interface ProfileSection {
  key: string;
  title: string;
  /** OKF frontmatter `type` — the reading side rejects a document without one */
  okfType: "Memory" | "Fact" | "Preference";
}

export interface RelationshipProfile {
  key: string;
  /** shown in the settings form */
  name: string;
  /** one line under the name, so the picker explains itself */
  description: string;
  /** document folder title: `${docTitle} — ${roomName}` */
  docTitle: string;
  /** document root icon */
  docIcon: string;
  sections: ProfileSection[];
  timeline: {
    /** section key holding the chronological record */
    section: string;
    /** event kinds the writer may classify a moment as, with their callout icon */
    events: { kind: string; icon: string }[];
    /** photos in a batch imply this event kind — a coded rule, not a model
     *  judgement. null = this relationship reads nothing into a photo. */
    photosImply: string | null;
    /** callout icon for an unclassified moment */
    defaultIcon: string;
  };
  /** Wording the prompts adopt. These are not decoration: "the couple's shared
   *  record" tells the model what kind of thing it is writing. */
  voice: {
    /** who the record-keeper keeps the record for, e.g. "this relationship" */
    subject: string;
    /** the two people, e.g. "the couple" / "the two colleagues" */
    parties: string;
    /** what makes a draft harmful enough to hold back (guard's AND condition) */
    guardHarm: string;
  };
  behavior: {
    /** speak up unprompted when the members must know something */
    proactive: boolean;
    /** a question to your member always earns a whisper on a call */
    whisperOnQuestion: boolean;
  };
  persona: { name: string; tone: string };
}
