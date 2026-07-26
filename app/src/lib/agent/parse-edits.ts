import type { ProfileSection, RelationshipProfile } from "./profiles/types";

// Which sections exist is the profile's business now (lib/agent/profiles):
// a working record keeps agreements and action items where a romance keeps a
// timeline of dates. A key is therefore a plain string, validated against the
// profile in hand rather than against a compile-time union.
export type SectionKey = string;

/** Timeline entries carry an event classification so the writer can lay them
 *  out in the formal template (date h1 → title h2 → callout → timed photos).
 *  Which kinds exist comes from the profile — "date"/"first-met" for a
 *  romance, "meeting"/"intro" for a working relationship. */
export interface TimelineEvent {
  kind: string;
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
export function keyByAlias(sections: readonly ProfileSection[]): Map<string, SectionKey> {
  return new Map(
    sections.flatMap((s) => [
      [s.key.toLowerCase(), s.key] as const,
      [s.title.toLowerCase(), s.key] as const,
    ])
  );
}

/** Event kinds this profile allows, lowercased for matching. */
function eventKinds(profile: RelationshipProfile): Set<string> {
  return new Set(profile.timeline.events.map((e) => e.kind.toLowerCase()));
}

/** LLM response (JSON array, ```json fences allowed) → validated DocEdit[]. Bad input throws. */
export function parseEdits(raw: string, profile: RelationshipProfile): DocEdit[] {
  const aliases = keyByAlias(profile.sections);
  const kinds = eventKinds(profile);
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
      typeof e?.section === "string" ? aliases.get(e.section.trim().toLowerCase()) : undefined;
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
      if (kinds.has(kind)) {
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
