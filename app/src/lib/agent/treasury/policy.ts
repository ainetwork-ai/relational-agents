import type { EvaluateInput, Payee, TreasuryDecision, TreasuryKind, TreasuryPolicy, TreasuryRule } from "./types";

/**
 * The relation's Treasury Rules, read by grammar — never by a model. A bullet
 * either parses completely (subject, amount band, outcome, and nothing else)
 * or it lands in `unparsed`, and an unparsed policy moves no money at all.
 * A condition we can't read ("…on weekends") must not be silently dropped:
 * that would turn a narrow rule into a broad one.
 */

/** open/closed boundary nudge: "from $50 to $200" includes $200, "over $200" excludes it */
const EPS = 0.000001;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;

function money(whole: string, frac: string | undefined): number {
  return Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
}

/** Words a rule subject may carry besides the parts we extract. Anything else
 *  is a condition we'd be ignoring, so the bullet is reported, not guessed.
 *  No destination words: where money goes is read only as PERSONAL_DEST, so
 *  "to our joint account" or "to a member's wallet" can never be dropped and
 *  leave a rule that covers every destination. */
const FILLER = new Set(
  (
    "shared group common joint expense expenses spending spend payment payments purchase purchases bill bills " +
    "investing invest investment investments idle spare extra funds fund money cash " +
    "the a an of at once in one go single transaction transactions transfer transfers " +
    "moving move moves sending send sends withdrawing withdraw withdrawal withdrawals " +
    "from out treasury treasury's our any amount and or"
  ).split(" ")
);

/** The one destination the grammar reads: a member's own wallet or account,
 *  however it is said ("to a member's wallet", "their own wallet", "personal
 *  wallets"). Every other destination stays in the subject and is reported. */
const PERSONAL_DEST =
  / (?:(?:to|into) )?(?:a |an |any |the )?(?:(?:member's|members'|someone's|anyone's|their) (?:own |personal )*|(?:own |personal )+)(?:wallets?|accounts?) /;

interface Subject {
  kind: TreasuryKind | "any";
  minUsd: number;
  maxUsd: number;
  minSharePct?: number;
  personal?: boolean;
}

function parseSubject(raw: string): Subject | null {
  let s = ` ${raw.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim()} `;

  // ── amount band (at most one) ──
  const bands: { re: RegExp; band: (m: RegExpMatchArray) => [number, number] }[] = [
    { re: new RegExp(String.raw` (?:from|between) ${MONEY} (?:to|and) ${MONEY} `), band: (m) => [money(m[1], m[2]), money(m[3], m[4]) + EPS] },
    { re: new RegExp(String.raw` (?:under|less than|below) ${MONEY} `), band: (m) => [0, money(m[1], m[2])] },
    { re: new RegExp(String.raw` up to ${MONEY} `), band: (m) => [0, money(m[1], m[2]) + EPS] },
    { re: new RegExp(String.raw` (?:over|above|more than) ${MONEY} `), band: (m) => [money(m[1], m[2]) + EPS, Infinity] },
    { re: new RegExp(String.raw` (?:at least ${MONEY}|${MONEY} or more) `), band: (m) => [money(m[1] ?? m[3], m[1] ? m[2] : m[4]), Infinity] },
    { re: / (?:of )?any amount /, band: () => [0, Infinity] },
  ];
  let minUsd = 0;
  let maxUsd = Infinity;
  let banded = false;
  for (const { re, band } of bands) {
    const m = s.match(re);
    if (!m) continue;
    if (banded) return null; // two amount bands in one bullet — which one did they mean?
    [minUsd, maxUsd] = band(m);
    banded = true;
    s = s.replace(re, " ");
  }
  if (!(minUsd < maxUsd)) return null;

  // ── share of the treasury ──
  let minSharePct: number | undefined;
  const share = s.match(/ (?:more than|over|above) (\d+(?:\.\d+)?) ?% of (?:the |our )?(?:treasury|funds|balance)(?: at once| in one go)? /);
  if (share) {
    minSharePct = Number(share[1]);
    s = s.replace(share[0], " ");
  }
  // any amount or percentage left over is a condition we did not read
  if (/[$%\d]/.test(s)) return null;
  s = ` ${s.replace(/[,;()]/g, " ").replace(/\s+/g, " ").trim()} `;

  // ── destination ──
  const personal = PERSONAL_DEST.test(s);
  if (personal) s = s.replace(PERSONAL_DEST, " ");

  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.some((w) => !FILLER.has(w))) return null;

  // ── kind ──
  const has = (re: RegExp) => words.some((w) => re.test(w));
  const kinds = new Set<TreasuryKind>();
  if (has(/^invest/)) kinds.add("investment");
  if (has(/^withdraw/)) kinds.add("withdrawal");
  if (has(/^(?:expenses?|spending|spend|payments?|purchases?|bills?)$/)) kinds.add("expense");
  let kind: TreasuryKind | "any";
  if (personal) {
    if ([...kinds].some((k) => k !== "withdrawal")) return null;
    kind = "withdrawal";
  } else if (kinds.size > 1) {
    return null;
  } else if (kinds.size === 1) {
    kind = [...kinds][0];
  } else if (has(/^(?:moving|move|moves|sending|send|sends|transfers?|transactions?|any)$/)) {
    kind = "any";
  } else {
    return null;
  }

  return {
    kind,
    minUsd,
    maxUsd,
    ...(minSharePct !== undefined ? { minSharePct } : {}),
    ...(personal ? { personal: true } : {}),
  };
}

type Outcome = { approvals: number; forbidden?: boolean };

function parseOutcome(raw: string): Outcome | null {
  const o = raw.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
  if (/^(?:the )?agent (?:may|can) (?:pay|act|spend|do it|decide|go ahead) on its own$/.test(o)) return { approvals: 0 };
  if (/^no approvals? (?:needed|required)$/.test(o)) return { approvals: 0 };
  if (/^(?:not allowed|never allowed|not permitted|forbidden|prohibited)$/.test(o)) return { approvals: 0, forbidden: true };
  const n =
    o.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:verified )?(?:members?|humans?|people) (?:must )?approve$/) ??
    o.match(/^(?:needs? )?(?:approval|approvals) (?:from|by) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:verified )?(?:members?|humans?|people)$/);
  if (n) {
    const count = NUMBER_WORDS[n[1]] ?? Number(n[1]);
    return Number.isInteger(count) && count >= 1 ? { approvals: count } : null;
  }
  return null;
}

function ruleLines(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

export function parseTreasuryPolicy(sectionText: string): TreasuryPolicy {
  const rules: TreasuryRule[] = [];
  const unparsed: string[] = [];
  for (const text of ruleLines(sectionText)) {
    const colon = text.indexOf(":");
    const subject = colon > 0 ? parseSubject(text.slice(0, colon)) : null;
    const outcome = subject ? parseOutcome(text.slice(colon + 1)) : null;
    if (!subject || !outcome) {
      unparsed.push(text);
      continue;
    }
    rules.push({ text, ...subject, ...outcome });
  }
  return { rules, unparsed };
}

export function parsePayees(sectionText: string): Payee[] {
  const out: Payee[] = [];
  for (const line of ruleLines(sectionText)) {
    const m = line.match(/^(.+?)\s*:\s*(0x[0-9a-fA-F]{40})$/);
    if (m && m[1].trim()) out.push({ name: m[1].trim(), address: m[2] as `0x${string}` });
  }
  return out;
}

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US")}`;

/** Short machine-derived restatement ("expenses $50–$200 → 2 approvals"), for
 *  logs and checks; agent messages cite rule.text verbatim instead. */
export function describeRule(rule: TreasuryRule): string {
  const subject =
    rule.kind === "any" ? "any move" : rule.kind === "expense" ? "expenses" : rule.kind === "investment" ? "investments" : "withdrawals";
  const lo = rule.minUsd > EPS ? rule.minUsd : 0;
  const band =
    rule.maxUsd === Infinity
      ? lo > 0
        ? ` over ${usd(Math.floor(lo))}`
        : ""
      : lo > 0
        ? ` ${usd(lo)}–${usd(rule.maxUsd)}`
        : ` under ${usd(rule.maxUsd)}`;
  const share = rule.minSharePct !== undefined ? ` over ${rule.minSharePct}% of the treasury` : "";
  const who = rule.personal ? " to a member's own wallet" : "";
  const outcome = rule.forbidden ? "not allowed" : rule.approvals === 0 ? "agent alone" : `${rule.approvals} approvals`;
  return `${subject}${band}${share}${who} → ${outcome}`;
}

export function evaluateCommand(input: EvaluateInput): TreasuryDecision {
  const { policy, kind, amountUsd, personal, balanceUsd } = input;

  if (policy.unparsed.length)
    return {
      outcome: "forbidden",
      rule: null,
      reason: `I can't read these treasury rules: ${policy.unparsed.map((l) => `"${l}"`).join("; ")}; I won't move money until they're fixed.`,
      applied: [],
    };

  if (!Number.isFinite(amountUsd) || amountUsd <= 0)
    return { outcome: "forbidden", rule: null, reason: "That isn't an amount I can move.", applied: [] };

  // A personal-wallet rule is about where the money lands, not the verb used to
  // ask: "pay $30 to Bea's wallet" must not slip past it as an "expense".
  const applicable = policy.rules.filter(
    (r) =>
      (r.kind === "any" || r.kind === kind || (r.personal === true && personal)) &&
      amountUsd >= r.minUsd &&
      amountUsd < r.maxUsd &&
      // "more than 30%" is strict: $300 of $1,000 is not more than 30%. Compared
      // without division so float noise can't decide the boundary.
      (r.minSharePct === undefined || balanceUsd <= 0 || amountUsd * 100 > r.minSharePct * balanceUsd) &&
      (!r.personal || personal)
  );

  const forbidden = applicable.find((r) => r.forbidden);
  if (forbidden) return { outcome: "forbidden", rule: forbidden, reason: forbidden.text, applied: applicable };

  // after the forbidding rules: "send $5,000 to my wallet" is refused on the
  // rule, not on the balance — a thin treasury must not imply a full one would pay
  if (amountUsd > balanceUsd) return { outcome: "insufficient", balanceUsd };

  if (!applicable.length)
    return { outcome: "forbidden", rule: null, reason: "No rule we agreed on covers this.", applied: [] };

  const required = Math.max(...applicable.map((r) => r.approvals));
  const rule = applicable.find((r) => r.approvals === required)!;
  return required === 0 ? { outcome: "auto", rule } : { outcome: "approval", required, rule, applied: applicable };
}
