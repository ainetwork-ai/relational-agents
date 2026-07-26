import type { RelationshipProfile } from "./types";

/**
 * The original profile — everything the agent did before profiles existed.
 *
 * Kept exactly as it was, deliberately: it is the default, so any drift here
 * is a behaviour change for every existing room.
 */
export const ROMANTIC: RelationshipProfile = {
  key: "romantic",
  name: "Romantic",
  description: "Two people building a life together. Keeps dates, photos and promises.",
  docTitle: "Relationship doc",
  docIcon: "🤝",
  sections: [
    { key: "overview", title: "Overview", okfType: "Fact" },
    { key: "timeline", title: "Timeline", okfType: "Memory" },
    { key: "decisions", title: "Decisions", okfType: "Fact" },
    { key: "people", title: "People notes", okfType: "Fact" },
    { key: "open-topics", title: "Open topics", okfType: "Fact" },
  ],
  timeline: {
    section: "timeline",
    events: [
      { kind: "date", icon: "💕" },
      { kind: "first-met", icon: "💘" },
    ],
    // photos shared between these two are a moment together, always
    photosImply: "date",
    defaultIcon: "💡",
  },
  voice: {
    subject: "relationship",
    parties: "the couple",
    guardHarm: "sending it as-is could hurt the other person or damage the relationship",
  },
  behavior: { proactive: true, whisperOnQuestion: true },
  persona: { name: "Relationship agent", tone: "warm" },
};
