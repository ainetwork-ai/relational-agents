import { randomUUID } from "node:crypto";
import type { ParsedBlock } from "@/lib/memory-parse";
import { TREASURY_TIME_ZONE } from "@/lib/agent/treasury/types";

/**
 * The Tokyo Trip demo's working record: the doc's own sections (the business
 * profile's Overview, Meeting log, Agreements, Action items, Contacts, Open
 * questions) as the room's agent would have filed them from the friends' chat.
 * The seed marks that chat as already recorded (its rules go straight into the
 * treasury sections), so the pipeline never files it and these sections stayed
 * empty headings. scripts/seed-tokyo-trip.mts writes them into a fresh room;
 * /world's Start over writes them back into the try-it copy, over whatever
 * visitors' requests appended since.
 *
 * `talk` holds the ids of the seeded chat's lines in the seed's order: Alex's
 * pot, Bea's hotel, Chris's small spends, Dana's bars, Eli's investing and 30%,
 * Bea's no-personal-wallet, Alex's deal, Eli's last $200. Each section cites
 * the lines it comes from, as the pipeline's own entries do. No emoji: the
 * agent's words carry none.
 */
export const TOKYO_TALK_LINES = 8;

/** the Treasury Activity's first line, before anything is spent */
export const TREASURY_OPENING = "Treasury opened with $1,000 — $200 from each of us.";

const dayOf = new Intl.DateTimeFormat("en-CA", {
  timeZone: TREASURY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type RecordSection = { key: string; title: string; blocks: ParsedBlock[] };

export function tokyoTripRecord(roomId: string, talk: string[], said: Date): RecordSection[] {
  const day = dayOf.format(said);
  // the pipeline's CHAT_ROUTE_PREFIX, written out so the seed need not load the pipeline
  const sources = (lines: number[]) => {
    const links = lines.flatMap((i) => (talk[i] ? [`/dm/${roomId}#msg-${talk[i]}`] : []));
    return links.length ? `Sources: ${links.join(" · ")}` : null;
  };
  const everyLine = [0, 1, 2, 3, 4, 5, 6, 7];
  const sections: { key: string; title: string; bullets: string[]; cites: number[] }[] = [
    {
      key: "overview",
      title: "Overview",
      bullets: [
        "Five friends, Alex, Bea, Chris, Dana and Eli, going to ETHGlobal Tokyo together, Sep 25–27.",
        "They pooled $200 each into a $1,000 trip pot. This room's agent holds it in its own wallet and pays only what the Treasury Rules allow; from $50 up, verified members approve with World ID.",
        "The hotel comes first: Hotel Gracery Shinjuku, near the venue.",
      ],
      cites: [0, 1, 7],
    },
    {
      key: "timeline",
      title: "Meeting log",
      bullets: [
        `${day}: Agreed on the trip pot, $200 each for ETHGlobal Tokyo, and the rules for spending it, written into this doc. All five paid in: $1,000.`,
      ],
      cites: everyLine,
    },
    {
      key: "decisions",
      title: "Agreements",
      bullets: [
        "Each of us puts $200 into the trip pot (Alex). All five have paid in: $1,000.",
        "The hotel comes first: Hotel Gracery Shinjuku, near the venue (Bea).",
        "Under $50, like snacks or a taxi, the agent pays on its own (Chris).",
        "$50 to $200 needs two of us; over $200, three (Dana).",
        "Investing idle funds needs three; moving more than 30% of the pot at once needs four (Eli).",
        "Nobody takes the pot home: nothing goes to anyone's personal wallet (Bea).",
        "These are our rules, written into this doc as the Treasury Rules (Alex).",
      ],
      cites: everyLine,
    },
    {
      key: "actions",
      title: "Action items",
      bullets: ["Pay the hotel deposit at Hotel Gracery Shinjuku first."],
      cites: [1],
    },
    {
      key: "people",
      title: "Contacts",
      bullets: [
        "Alex: proposed the trip pot and the doc the rules live in.",
        "Bea: found the hotel; set the rule that nothing goes to a personal wallet.",
        "Chris: the agent pays small things on its own.",
        "Dana: how many of us approve a bigger spend.",
        "Eli: the investing and 30% bars; paid in last.",
        "Hotel Gracery Shinjuku: our hotel, near the venue, and a payee.",
        "Tokyo Trip agent: keeps this record and holds the pot.",
      ],
      cites: everyLine,
    },
    {
      key: "open-topics",
      title: "Open questions",
      bullets: [
        "What happens to whatever is left in the pot after the trip?",
        "Do we invest the idle funds until the trip? That needs three of us.",
      ],
      cites: [4],
    },
  ];
  return sections.map((s) => {
    const cite = sources(s.cites);
    const lines: [ParsedBlock["type"], string][] = [
      ...s.bullets.map((text): [ParsedBlock["type"], string] => ["bulleted_list", text]),
      ...(cite ? [["paragraph", cite] as [ParsedBlock["type"], string]] : []),
    ];
    return {
      key: s.key,
      title: s.title,
      blocks: lines.map(([type, text], i) => ({ id: randomUUID(), type, content: { text }, position: i + 1 })),
    };
  });
}
