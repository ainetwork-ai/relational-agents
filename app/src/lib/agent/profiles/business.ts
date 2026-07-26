import type { RelationshipProfile } from "./types";

/**
 * Two people who work together.
 *
 * Section keys are deliberately shared with the romantic profile wherever the
 * meaning carries over — `timeline` is a meeting log rather than a story of
 * dates, but it is the same chronological record, so switching profiles keeps
 * the file and changes only its label. `actions` is the one genuinely new
 * thing, and it arrives as a new file beside the others.
 *
 * What actually differs is judgement: a photo here is a whiteboard, not a
 * moment together, and holding back a message is about what it commits you to,
 * not about hurt feelings.
 */
export const BUSINESS: RelationshipProfile = {
  key: "business",
  name: "Business",
  description: "Colleagues, clients or partners. Keeps agreements, action items and who's who.",
  docTitle: "Working record",
  docIcon: "💼",
  sections: [
    { key: "overview", title: "Overview", okfType: "Fact" },
    { key: "timeline", title: "Meeting log", okfType: "Memory" },
    { key: "decisions", title: "Agreements", okfType: "Fact" },
    { key: "actions", title: "Action items", okfType: "Fact" },
    { key: "people", title: "Contacts", okfType: "Fact" },
    { key: "open-topics", title: "Open questions", okfType: "Fact" },
  ],
  timeline: {
    section: "timeline",
    events: [
      { kind: "meeting", icon: "📅" },
      { kind: "intro", icon: "🤝" },
    ],
    // a photo in a work chat is a whiteboard or a receipt — it does not make
    // the exchange an event on its own
    photosImply: null,
    defaultIcon: "📌",
  },
  voice: {
    subject: "working relationship",
    parties: "the two of them",
    guardHarm:
      "sending it as-is could commit them to something they did not agree to, contradict what was agreed, or damage the working relationship",
    suggestion: "a place to meet or a next step",
  },
  behavior: { proactive: true, whisperOnQuestion: true },
  persona: { name: "Working agent", tone: "concise" },
};
