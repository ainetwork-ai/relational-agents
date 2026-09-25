import type { TreasuryCommand, TreasuryKind } from "./types";

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

/** the request is not "do it now, exactly this" */
const HEDGE =
  /\b(?:not|don'?t|do not|never|cancel|stop|wait|hold off|later|tomorrow|tonight|next (?:week|month|year)|yesterday|already|if|unless|when|whether|should|maybe|might|once)\b/i;

const EXPENSE_VERBS = new Set(["pay", "book", "reserve", "buy", "purchase", "cover", "spend", "deposit"]);
const TRANSFER_VERBS = new Set(["send", "transfer", "give"]);

const TO_SELF =
  /\b(?:back\s+)?to\s+me\b|\bto\s+myself\b|\b(?:to|into|in)\s+my\s+(?:own\s+|personal\s+)?(?:wallet|account)\b|\bmy\s+(?:own\s+|personal\s+)?wallet\b/gi;
const SEND_ME = /^(?:send|give|transfer|pay)\s+me(?:\s+back)?\b/i;
/** money coming INTO the treasury is not ours to move out */
const INTO_TREASURY = /\b(?:in|into|to)\s+(?:the|our)\s+(?:treasury|shared wallet|pot|fund|kitty)\b/i;

const KO_TO_SELF = /내\s?지갑|내\s?계좌|나한테|나에게/;
const KO_REQUEST = /(?:줘|주세요|줄래|주라|주겠니)[.!?~\s]*$/;
const KO_HEDGE = /말고|하지\s?마|취소|나중에|내일|어제|이미|했어|했다|냈어|보냈어|하면|이면/;

interface Amounts {
  values: number[];
  spans: [number, number][];
  invalid: boolean;
}

const AMOUNT_RES: { re: RegExp; dollarSign?: boolean }[] = [
  { re: /\$\s?(\d[\d,]*(?:\.\d+)?)/g, dollarSign: true },
  { re: /\busd\s?(\d[\d,]*(?:\.\d+)?)/gi, dollarSign: true },
  { re: /(\d[\d,]*(?:\.\d+)?)\s?(?:dollars?|bucks|usd)\b/gi },
  { re: /(\d[\d,]*(?:\.\d+)?)\s?달러/g },
];

function findAmounts(t: string): Amounts {
  const out: Amounts = { values: [], spans: [], invalid: false };
  for (const { re, dollarSign } of AMOUNT_RES) {
    for (const m of t.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      const num = m[1];
      // "$1.2k", "$180m", "$1,20" — a shape we'd have to guess at
      if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(num)) out.invalid = true;
      if (dollarSign && /[a-z0-9%]/i.test(t[end] ?? "") && !/^\s?(?:dollars?|bucks|usd)\b/i.test(t.slice(end)))
        out.invalid = true;
      out.values.push(Number(num.replace(/,/g, "")));
      out.spans.push([start, end]);
    }
  }
  return out;
}

function oneAmount(a: Amounts): number | null {
  if (a.invalid || !a.values.length) return null;
  const cents = new Set(a.values.map((v) => Math.round(v * 100)));
  if (cents.size !== 1) return null; // "pay $180 of the $300 bill" — which one?
  const v = [...cents][0] / 100;
  return v > 0 ? v : null;
}

/** cut the amount spans (and a connector in front: ", $180" / "for $180") */
function withoutAmounts(t: string, spans: [number, number][]): string {
  // "$180 dollars" is matched twice, overlapping — cut the union once
  const merged: [number, number][] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let s = t;
  for (const [a, b] of merged.reverse()) {
    const before = s.slice(0, a).replace(/(?:\b(?:for|of|at|worth|costing|about|around)\s+|,\s*)$/i, "");
    s = `${before} ${s.slice(b).replace(/^\s?(?:dollars?|bucks|usd|달러)\b/i, "")}`;
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
    /잔액|잔고/.test(s)
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
  if (HEDGE.test(t) || INTO_TREASURY.test(t)) return null;

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
  if (KO_TO_SELF.test(t) || /출금/.test(t)) {
    kind = "withdrawal";
    toSelf = true;
  } else if (/투자/.test(t)) kind = "investment";
  else if (/보내|송금|결제|지불|내\s?줘|예약|사\s?줘|구매|계산/.test(t)) kind = "expense";
  if (!kind) return null;

  const memo = tidyMemo(
    withoutAmounts(t, amounts.spans)
      .replace(KO_TO_SELF, " ")
      .replace(/(?:공금|모임\s?통장|통장|지갑)(?:에서|으로|로)?/g, " ")
      .replace(/\S*(?:줘|주세요|줄래|주라|주겠니)[.!?~\s]*$/, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(?:에게|한테|으로|에|을|를)$/, ""))
      .join(" ")
  );
  return money(kind, amountUsd, memo, toSelf, raw);
}

export function matchTreasuryCommand(text: string, agentName?: string): TreasuryCommand | null {
  const raw = text;
  let t = text.replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  if (agentName?.trim()) t = t.replace(new RegExp(`@${escapeRe(agentName.trim())}`, "gi"), " ");
  t = t.replace(/@agent\b/gi, " ").trim();
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/^[\s,:;.!-]+/, "").replace(PREAMBLE, "").trim();
  }
  if (!t) return null;

  const cmd = matchEnglish(t, raw) ?? (/[가-힣]/.test(t) ? matchKorean(t, raw) : null);
  if (cmd) return cmd;
  // a balance question moves nothing, so it may be matched loosely — but not
  // when an amount is on the table: that is a money sentence we didn't read
  const a = findAmounts(t);
  if (!a.values.length && isStatus(t)) return { kind: "status", raw };
  return null;
}
