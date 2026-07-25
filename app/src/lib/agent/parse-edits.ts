/** Relationship SSOT doc skeleton — the content contract with the read chatbot. */
export const SECTIONS = [
  { key: "overview", title: "Overview" },
  { key: "timeline", title: "Timeline" },
  { key: "decisions", title: "Decisions" },
  { key: "people", title: "People notes" },
  { key: "open-topics", title: "Open topics" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

/** Timeline entries carry an event classification so the writer can lay them
 *  out in the formal template (date h1 → title h2 → callout → timed photos).
 *  "date" = a shared outing/date; "first-met" = how the two met. */
export interface TimelineEvent {
  kind: "date" | "first-met";
  /** YYYY-MM-DD; when absent the writer falls back to the message date. */
  date?: string;
  /** short event title, e.g. "Belém day — natas at the source" */
  title?: string;
}

export interface DocEdit {
  section: SectionKey;
  markdown: string;
  sourceMessageIds: string[];
  event?: TimelineEvent;
}

// LLMs often emit the display title ("Overview") or odd casing instead of the
// key — normalize both keys and titles to lowercase and accept them as keys
// (only unknown values are rejected).
const KEY_BY_ALIAS = new Map<string, SectionKey>(
  SECTIONS.flatMap((s) => [
    [s.key.toLowerCase(), s.key],
    [s.title.toLowerCase(), s.key],
  ])
);

/** LLM response (JSON array, ```json fences allowed) → validated DocEdit[]. Bad input throws. */
export function parseEdits(raw: string): DocEdit[] {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = (fenced ? fenced[1] : raw).trim();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`agent: LLM output is not JSON: ${body.slice(0, 120)}`);
  }
  if (!Array.isArray(data)) throw new Error("agent: LLM output is not an array");
  const edits: DocEdit[] = [];
  for (const item of data) {
    const e = item as Record<string, unknown>;
    const section =
      typeof e?.section === "string" ? KEY_BY_ALIAS.get(e.section.trim().toLowerCase()) : undefined;
    if (!section) throw new Error(`agent: unknown section ${String(e?.section)}`);
    if (typeof e.markdown !== "string") throw new Error("agent: markdown must be string");
    if (!e.markdown.trim()) continue; // ignore empty edits
    const ids = Array.isArray(e.sourceMessageIds)
      ? e.sourceMessageIds.filter((x): x is string => typeof x === "string")
      : [];
    // event is best-effort: a malformed one degrades to a plain edit, never throws
    let event: TimelineEvent | undefined;
    const ev = e.event as Record<string, unknown> | null | undefined;
    if (ev && typeof ev === "object") {
      const kind = typeof ev.kind === "string" ? ev.kind.trim().toLowerCase() : "";
      if (kind === "date" || kind === "first-met") {
        event = { kind };
        if (typeof ev.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.date.trim()))
          event.date = ev.date.trim();
        if (typeof ev.title === "string" && ev.title.trim())
          event.title = ev.title.trim().slice(0, 120);
      }
    }
    edits.push({ section, markdown: e.markdown, sourceMessageIds: ids, ...(event ? { event } : {}) });
  }
  return edits;
}
