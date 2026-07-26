import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRoomStates } from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { profileForRoom } from "./profiles";
import { okfDocTreeFromState, readOkfSectionTexts } from "./okf-docs";

/**
 * Pre-send fact-check gate (decline).
 *
 * Judges "does this draft contradict the record" against the relationship doc
 * (OKF files). Concept rules inherited from the relation-agent design —
 * strict, because false positives kill the feature:
 *
 * 1. AND condition — decline only when [contradicts the record] AND
 * [risks damaging the relationship]
 * 2. absent ≠ false — new topics not in the record are never blocked
 * 3. prefilter — no related memory → the LLM isn't called at all
 * (checked:false)
 * 4. evidence required — no quote actually found in the doc → never
 * escalate to decline (filters invented evidence)
 *
 * The human decides — callers must allow force-send even on decline.
 */

export interface GuardEvidence {
  /** section title the evidence came from (e.g. "Timeline") */
  section: string;
  quote: string;
}

export interface GuardResult {
  verdict: "allow" | "decline";
  /** false = no memory to consult, check skipped (the UI shows no badge) */
  checked: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: GuardEvidence[];
}

/** Cap on doc volume fed to the prompt — growth can't blow the prompt up. */
const MAX_DOC_CHARS = 6_000;

const ALLOW_UNCHECKED: GuardResult = { verdict: "allow", checked: false };

/** Character-bigram set that works for Korean text too (relevance estimation without morphology). */
function bigrams(s: string): Set<string> {
  const t = s.replace(/[^0-9A-Za-z가-힣]/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** Comparison normalization stripping spaces/symbols (used for quote verification). */
function norm(s: string): string {
  return s.replace(/\s+/g, "").replace(/["'`“”‘’]/g, "");
}

interface LlmVerdict {
  contradicts?: boolean;
  harmful?: boolean;
  reason?: string;
  suggestion?: string;
  evidence?: { quote?: string }[];
}

function parseVerdict(raw: string): LlmVerdict | null {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    const v = JSON.parse(body) as LlmVerdict;
    return typeof v === "object" && v !== null ? v : null;
  } catch {
    return null;
  }
}

/** Offline/test path — deterministic. A draft containing [fake-decline] is blocked. */
function fakeCheck(draft: string, docText: string): GuardResult {
  if (!draft.includes("[fake-decline]")) return { verdict: "allow", checked: true };
  const firstLine = docText.split("\n").find((l) => l.trim()) ?? "";
  return {
    verdict: "decline",
    checked: true,
    reason: "[fake-guard] This conflicts with the record.",
    suggestion: "[fake-guard] Rewrite it to match the record.",
    evidence: firstLine ? [{ section: "Timeline", quote: firstLine.slice(0, 120) }] : [],
  };
}

/**
 * Checks one draft. With no relationship doc or no related memory it
 * answers `{verdict:"allow", checked:false}` — a quiet pass.
 */
export async function checkDraft(roomId: string, draft: string): Promise<GuardResult> {
  const text = draft.trim();
  if (!text) return ALLOW_UNCHECKED;

  const [state] = await db
    .select()
    .from(agentRoomStates)
    .where(eq(agentRoomStates.roomId, roomId));
  const profile = await profileForRoom(roomId);
  const tree = okfDocTreeFromState(state, profile);
  if (!tree) return ALLOW_UNCHECKED; // a room with no memories yet

  const sections = readOkfSectionTexts(tree, profile);
  const bySection = profile.sections.map((s) => ({ title: s.title, body: sections[s.key] ?? "" })).filter(
    (s) => s.body.trim()
  );
  const docText = bySection.map((s) => `### ${s.title}\n${s.body}`).join("\n\n");
  if (!docText.trim()) return ALLOW_UNCHECKED;

 // Prefilter: pass as "no related memory" only when draft and doc share
 // **nothing**. Raising the threshold lets drafts that share just one key
 // noun (e.g. mentioning the doc's "Sokcho") slip through unchecked — we saw
 // that leak, so it sits at 1. False positives aren't fought here: the AND
 // condition + evidence check do that.
  if (overlap(bigrams(text), bigrams(docText)) === 0) return ALLOW_UNCHECKED;

  if (process.env.AGENT_FAKE_LLM === "1") return fakeCheck(text, docText);

  const doc = docText.length > MAX_DOC_CHARS ? docText.slice(0, MAX_DOC_CHARS) : docText;
  let raw: string;
  try {
    raw = await aiChat(
      [
        {
          role: "system",
          content:
            `You are a fact-checker guarding the shared record of a ${profile.voice.subject}. Decide whether the user's draft ` +
            "contradicts that record.\n" +
            "Block (contradicts=true, harmful=true) **only when both are true**:\n" +
            "  contradicts = it directly contradicts a recorded fact (new content absent from the record is NOT a contradiction)\n" +
            `  harmful = ${profile.voice.guardHarm}\n` +
            "Important: **never block something just because it is not in the record.** New topics, plans and feelings always pass.\n" +
            "If you judge it a contradiction, put the exact sentence copied from the document into evidence (no summarizing or rewording).\n" +
            'Output JSON only: {"contradicts":bool,"harmful":bool,"reason":"...","suggestion":"...","evidence":[{"quote":"..."}]}',
        },
        {
          role: "user",
          content: `## Relationship record\n${doc}\n\n## Draft to send\n${text}`,
        },
      ],
      { maxTokens: 500, temperature: 0.1 }
    );
  } catch (e) {
 // a guard outage must never block sending — pass, log the reason
    console.error("guard: llm failed:", e);
    return ALLOW_UNCHECKED;
  }

  const v = parseVerdict(raw);
  if (!v) return { verdict: "allow", checked: true };
  if (!(v.contradicts === true && v.harmful === true)) return { verdict: "allow", checked: true };

 // evidence check: only quotes actually present in the doc count (drops invented evidence)
  const evidence: GuardEvidence[] = [];
  for (const e of v.evidence ?? []) {
    const q = (e?.quote ?? "").trim();
    if (!q) continue;
    const hit = bySection.find((s) => norm(s.body).includes(norm(q)));
    if (hit) evidence.push({ section: hit.title, quote: q });
  }
 // rule 4 — no verifiable evidence, no block (false-positive prevention)
  if (!evidence.length) return { verdict: "allow", checked: true };

  return {
    verdict: "decline",
    checked: true,
    reason: v.reason?.trim() || "This conflicts with the record.",
    suggestion: v.suggestion?.trim() || undefined,
    evidence,
  };
}
