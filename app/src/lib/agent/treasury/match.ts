import type { TreasuryCommand, TreasuryKind } from "./types";
import { TREASURY_KO as KO } from "@/i18n/content/agent";

/**
 * Chat → treasury command, by sentence shape. A false positive here moves
 * money, so the matcher only accepts an imperative addressed to the agent
 * ("pay …", "book …", "send $X to …") with exactly one explicit USD amount,
 * and gives up on anything conditional, negated, scheduled or narrated
 * ("I paid $180 yesterday", "don't pay …", "pay $30 if Bea agrees").
 * A missed command costs a retyped message; a wrong one costs the treasury.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** greetings and politeness in front of the verb */
const PREAMBLE =
  /^(?:hi|hey|hello|ok|okay|so|alright|agent|please|pls|kindly|now|can you|could you|would you|will you|go ahead and)\b[\s,!:.-]*/i;

/** the request is not "do it now, exactly this" — conditional, negated, narrated or scheduled
 *  ("once we land" is a condition; "at once" is not) */
const HEDGE =
  /\b(?:not|don'?t|do not|never|cancel|stop|wait|hold off|later|tomorrow|tonight|next (?:week|month|year)|yesterday|already|if|unless|when|whether|should|maybe|might|once (?:we|you|they|he|she|it|i|the|everyone|everybody)|after|before|until|till|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|in \d+ (?:minutes?|hours?|days?|weeks?|months?)|on the \d+(?:st|nd|rd|th)?)\b/i;

/** the figure said is not the total: "$12 each", "$180 per night", "2x $90", "180 dollars and 50 cents" */
const MULTIPLIER = /\b(?:each|per|apiece|times|twice|thrice|cents?)\b|\b\d+\s?[x×](?=\s|\$|\d|$)|(?:^|\s)[x×]\s?\d|×/i;

/** "@agent adopt the new rules" — the one sentence that puts an edit of the rules to a vote */
const ADOPT =
  /^(?:adopt|ratify|accept)\s+(?:the\s+|our\s+)?(?:new\s+|updated\s+|edited\s+|changed\s+|current\s+)?(?:treasury\s+)?(?:rules|payees|members|membership|changes|rules and payees|payees and rules)\b[\s.!]*$/i;

/** words that ask for money to move, in any tense — mentionsMoney's half of "a money sentence" */
const MONEY_VERB = new RegExp(
  String.raw`\b(?:pay|paid|paying|send|sent|sending|transfer\w*|book\w*|reserve\w*|buy|bought|buying|purchas\w*|withdr[ae]w\w*|invest\w*|move|moved|moving|spend|spent|spending|give|gave|giving|deposit\w*|cover\w*|reimburs\w*|refund\w*|tip)\b|` + KO.moneyVerbs.join("|"),
    "i"
  );

const EXPENSE_VERBS = new Set(["pay", "book", "reserve", "buy", "purchase", "cover", "spend", "deposit"]);
const TRANSFER_VERBS = new Set(["send", "transfer", "give"]);

const TO_SELF =
  /\b(?:back\s+)?to\s+me\b|\bto\s+myself\b|\b(?:to|into|in)\s+my\s+(?:own\s+|personal\s+)?(?:wallet|account)\b|\bmy\s+(?:own\s+|personal\s+)?wallet\b/gi;
const SEND_ME = /^(?:send|give|transfer|pay)\s+me(?:\s+back)?\b/i;
/** money coming INTO the treasury is not ours to move out */
const INTO_TREASURY = /\b(?:in|into|to)\s+(?:the|our)\s+(?:treasury|shared wallet|pot|fund|kitty)\b/i;

const KO_TO_SELF = new RegExp(KO.toSelf.join("|"));
const KO_REQUEST = new RegExp(String.raw`(?:${KO.requestEndings.join("|")})[.!?~\s]*$`);
const KO_HEDGE = new RegExp(KO.hedge.join("|"));
const KO_STATUS = new RegExp(KO.status.join("|"));
const KO_EXPENSE = new RegExp(KO.expense.join("|"));
const HANGUL = /[\uAC00-\uD7A3]/;

interface Amounts {
  values: number[];
  spans: [number, number][];
  invalid: boolean;
}

// A number is "180", "1,800" or "180.50" — never "180," ("$180, thanks"): a
// grouping comma must be followed by exactly three digits to count.
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;
const AMOUNT_RES: { re: RegExp; dollarSign?: boolean }[] = [
  { re: new RegExp(String.raw`\$\s?${NUM}`, "g"), dollarSign: true },
  { re: new RegExp(String.raw`\busd\s?${NUM}`, "gi"), dollarSign: true },
  { re: new RegExp(String.raw`(?<![\d,.])${NUM}\s?(?:dollars?|bucks|usd)\b`, "gi") },
  { re: new RegExp(String.raw`(?<![\d,.])${NUM}\s?${KO.dollar}`, "g") },
];

function findAmounts(t: string): Amounts {
  const out: Amounts = { values: [], spans: [], invalid: false };
  for (const { re, dollarSign } of AMOUNT_RES) {
    for (const m of t.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      const after = t.slice(end);
      // "$180.505", "$1.2k", "$180m", "$1,20", "$1 800" — a shape we'd have to guess at
      if (m[2] !== undefined && m[2].length > 2) out.invalid = true;
      if (/^[.,]\d|^\s\d/.test(after)) out.invalid = true;
      if (dollarSign && /[a-z0-9%]/i.test(t[end] ?? "") && !/^\s?(?:dollars?|bucks|usd)\b/i.test(after))
        out.invalid = true;
      // "HK$500", "A$40", "NT$90" — dollars, but not US ones
      if (t[start] === "$" && /[a-z]/i.test(t[start - 1] ?? "")) out.invalid = true;
      out.values.push(Number(`${m[1].replace(/,/g, "")}${m[2] !== undefined ? `.${m[2]}` : ""}`));
      out.spans.push([start, end]);
    }
  }
  return out;
}

/** overlapping matches of one figure ("$180 dollars" is matched twice) as one span */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

function oneAmount(a: Amounts): number | null {
  if (a.invalid || !a.values.length) return null;
  // said once: "$30 for the taxi and $30 for snacks" is two payments, even
  // though both are $30 — only overlapping matches are the same figure
  if (mergeSpans(a.spans).length !== 1) return null;
  const cents = new Set(a.values.map((v) => Math.round(v * 100)));
  if (cents.size !== 1) return null; // "pay $180 of the $300 bill" — which one?
  const v = [...cents][0] / 100;
  return v > 0 ? v : null;
}

/** cut the amount spans (and a connector in front: ", $180" / "for $180") */
function withoutAmounts(t: string, spans: [number, number][]): string {
  const merged = mergeSpans(spans);
  let s = t;
  for (const [a, b] of merged.reverse()) {
    const before = s.slice(0, a).replace(/(?:\b(?:for|of|at|worth|costing|about|around)\s+|,\s*)$/i, "");
    s = `${before} ${s.slice(b).replace(new RegExp(String.raw`^\s?(?:dollars?|bucks|usd|${KO.dollar})\b`, "i"), "")}`;
  }
  return s;
}

function tidyMemo(s: string): string {
  let m = s
    .replace(/\bfrom\s+(?:the|our)\s+(?:treasury|shared wallet|wallet|fund|pot)\b/gi, " ")
    .replace(/\b(?:with|using)\s+(?:the|our)\s+(?:treasury|shared)\s+(?:money|funds)\b/gi, " ")
    .replace(/\b(?:please|pls|thanks|thank you|right away|asap)\b/gi, " ")
    .replace(/\b(?:the|our)\b/gi, " ")
    // "…for snacks and tell me the balance": the second clause is not what it's for
    .replace(/\s*(?:,|\band\b|\bthen\b)\s+(?:tell|show|let|remind|check|confirm|post|update)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // leading/trailing connectors and punctuation left behind by the cuts
  for (let prev = ""; prev !== m; ) {
    prev = m;
    m = m
      .replace(/^(?:[\s,.:;!?'"-]+|(?:to|for|of|on|a|an|and)\b)/i, "")
      .replace(/(?:[\s,.:;!?'"-]+|\b(?:to|for|of|on|a|an|and))$/i, "")
      .trim();
  }
  return m.slice(0, 120);
}

function isStatus(t: string): boolean {
  const s = t.toLowerCase();
  return (
    /(?:^|\b(?:our|the|treasury|current|wallet|shared|remaining)\s+)balance\b/.test(s) ||
    /\btreasury status\b|^treasury\s*\??$|^status\s*\??$/.test(s) ||
    /\bhow much (?:money )?(?:do we have|have we got|is left|is in (?:the|our) (?:treasury|wallet|pot))\b/.test(s) ||
    /\bwhat(?:'s| is) in (?:the|our) treasury\b/.test(s) ||
    KO_STATUS.test(s)
  );
}

function money(kind: TreasuryKind, amountUsd: number, memo: string, toSelf: boolean, raw: string): TreasuryCommand {
  return { kind, amountUsd, memo, toSelf, raw };
}

function matchEnglish(t: string, raw: string): TreasuryCommand | null {
  const verb = t.match(/^([a-z]+)\b/i)?.[1].toLowerCase();
  if (!verb) return null;
  const isExpense = EXPENSE_VERBS.has(verb);
  const isTransfer = TRANSFER_VERBS.has(verb);
  if (!isExpense && !isTransfer && verb !== "withdraw" && verb !== "invest" && verb !== "move") return null;
  if (HEDGE.test(t) || INTO_TREASURY.test(t) || MULTIPLIER.test(t)) return null;

  const amounts = findAmounts(t);
  const amountUsd = oneAmount(amounts);
  if (amountUsd === null) return null;

  const sendMe = SEND_ME.exec(t);
  const toSelf = Boolean(sendMe) || new RegExp(TO_SELF.source, "i").test(t);

  // everything but the verb, the amount and the destination-is-me phrase
  let rest = withoutAmounts(t, amounts.spans);
  rest = sendMe ? rest.replace(SEND_ME, " ") : rest.replace(/^\s*[a-z]+\b/i, " ");
  rest = rest.replace(TO_SELF, " ");
  const destination = /\b(?:to|into)\s+\S/i.test(rest);
  const memo = tidyMemo(rest);

  // a withdrawal has nowhere to land but the asker's own wallet; paying a
  // named payee is "pay"/"send", not "withdraw"
  if (toSelf || verb === "withdraw") return money("withdrawal", amountUsd, memo, true, raw);
  if (verb === "invest") return money("investment", amountUsd, memo, false, raw);
  // "send $180" / "move $300" without saying where — not a command we can act on
  if (isTransfer) return destination && memo ? money("expense", amountUsd, memo, false, raw) : null;
  if (verb === "move") return null;
  // "deposit $100" alone reads as putting money in, not paying a deposit
  if (verb === "deposit" && !memo) return null;
  return money("expense", amountUsd, memo, false, raw);
}

function matchKorean(t: string, raw: string): TreasuryCommand | null {
  if (!KO_REQUEST.test(t) || KO_HEDGE.test(t)) return null;
  const amounts = findAmounts(t);
  const amountUsd = oneAmount(amounts);
  if (amountUsd === null) return null;

  let kind: TreasuryKind | null = null;
  let toSelf = false;
  if (KO_TO_SELF.test(t) || t.includes(KO.withdraw)) {
    kind = "withdrawal";
    toSelf = true;
  } else if (t.includes(KO.invest)) kind = "investment";
  else if (KO_EXPENSE.test(t)) kind = "expense";
  if (!kind) return null;

  const memo = tidyMemo(
    withoutAmounts(t, amounts.spans)
      .replace(KO_TO_SELF, " ")
      .replace(new RegExp(KO.source, "g"), " ")
      .replace(new RegExp(String.raw`\S*(?:${KO.requestEndings.join("|")})[.!?~\s]*$`), " ")
      .split(/\s+/)
      .map((w) => w.replace(new RegExp(`${KO.particles}$`), ""))
      .join(" ")
  );
  return money(kind, amountUsd, memo, toSelf, raw);
}

/** the message without its address to the agent and the politeness in front */
function normalize(text: string, agentName?: string): string {
  let t = text.replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  if (agentName?.trim()) t = t.replace(new RegExp(`@${escapeRe(agentName.trim())}`, "gi"), " ");
  t = t.replace(/@agent\b/gi, " ").trim();
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/^[\s,:;.!-]+/, "").replace(PREAMBLE, "").trim();
  }
  return t;
}

/**
 * A message that talks about moving money (a money word and an amount) —
 * whether or not matchTreasuryCommand could read it. When it could not, the
 * caller answers with a fixed "nothing was moved" instead of handing the
 * sentence to a model that might say otherwise.
 */
export function mentionsMoney(text: string, agentName?: string): boolean {
  const t = normalize(text, agentName);
  if (!t || !MONEY_VERB.test(t)) return false;
  const a = findAmounts(t);
  return a.invalid || a.values.length > 0;
}

export function matchTreasuryCommand(text: string, agentName?: string): TreasuryCommand | null {
  const raw = text;
  const t = normalize(text, agentName);
  if (!t) return null;
  if (ADOPT.test(t)) return { kind: "adopt", raw };

  const cmd = matchEnglish(t, raw) ?? (HANGUL.test(t) ? matchKorean(t, raw) : null);
  if (cmd) return cmd;
  // a balance question moves nothing, so it may be matched loosely — but not
  // when an amount is on the table: that is a money sentence we didn't read
  const a = findAmounts(t);
  if (!a.values.length && isStatus(t)) return { kind: "status", raw };
  return null;
}
