import type { RelationshipProfile } from "./types";

/**
 * A family looking after each other — the default.
 *
 * Grandma, mom and dad (or whoever the family is) share one record: when they
 * gather, who is taking which medicine and when the next check-up is, what was
 * decided, and who likes what. Section keys match the earlier default's where
 * the meaning carries over, so a room that switches profile keeps its history.
 */
export const FAMILY: RelationshipProfile = {
  key: "family",
  name: "Family",
  description: "A family looking after each other. Keeps gatherings, health and care, plans and photos.",
  docTitle: "Family doc",
  docIcon: "🏡",
  sections: [
    { key: "overview", title: "Overview", okfType: "Fact" },
    { key: "timeline", title: "Family timeline", okfType: "Memory" },
    { key: "care", title: "Health & care", okfType: "Fact" },
    { key: "decisions", title: "Plans & chores", okfType: "Fact" },
    { key: "people", title: "Family notes", okfType: "Fact" },
    { key: "open-topics", title: "Open topics", okfType: "Fact" },
  ],
  timeline: {
    section: "timeline",
    events: [
      { kind: "gathering", icon: "🏡" },
      { kind: "holiday", icon: "🌕" },
      { kind: "milestone", icon: "🎂" },
      { kind: "trip", icon: "✈️" },
      { kind: "checkup", icon: "🩺" },
    ],
    // photos shared in the family room are the family being together
    photosImply: "gathering",
    defaultIcon: "📌",
  },
  voice: {
    subject: "family",
    parties: "the family",
    guardHarm: "sending it as-is could hurt a family member or start a family quarrel",
    suggestion: "a family outing, a dish to cook together, or a way to help each other",
  },
  behavior: { proactive: true, whisperOnQuestion: true },
  persona: { name: "Family agent", tone: "warm" },
};
