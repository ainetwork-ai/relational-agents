// GENERATED from ens/src/send-request.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/send-request.ts
// "send Minjun 20 USDC" → an amount and, if said, a kinship word. Matched in code,
// never by a model: this sentence moves money.
import { formatUnits, parseUnits } from "viem";
import { MAX_SEND_MICRO, MIN_SEND_MICRO, USDC_DECIMALS } from "./config";

export type Kinship =
  | "son"
  | "daughter"
  | "child"
  | "grandson"
  | "granddaughter"
  | "grandchild"
  | "daughter-in-law"
  | "son-in-law";

const SEND_VERB = /\b(send|give|transfer)\b/i;
// a number glued to or spaced from "usdc"; a "$" in front is tolerated
const AMOUNT_ANY = /\$?\s*([\d.,]+)\s*usdc\b/gi;
const AMOUNT_OK = /^\d+(\.\d{1,6})?$/;
// longest first, so "grandson" is never read as "son"
const KINSHIP_RE =
  /\b(daughter-in-law|son-in-law|granddaughter|grandson|grandchild|daughter|son|child)\b/i;

export function isSendRequest(text: string): boolean {
  return SEND_VERB.test(text) && /\d\s*usdc\b/i.test(text);
}

/** "send Minjun some money": a send verb and money or USDC, but no USDC amount. The send
 *  skill asks for one amount when the sentence names someone below the asker, and otherwise
 *  hands it back to the model ("how much money did we give at Chuseok?"). */
export function isSendWithoutAmount(text: string): boolean {
  return SEND_VERB.test(text) && /\b(money|usdc)\b/i.test(text) && !isSendRequest(text);
}

/** "my grandson" → grandson; null when no kinship word is said. */
export function kinshipOf(text: string): Kinship | null {
  return (KINSHIP_RE.exec(text)?.[1]?.toLowerCase() as Kinship | undefined) ?? null;
}

export function parseSendRequest(text: string): { amountMicro: bigint; kinship: Kinship | null } | null {
  if (!isSendRequest(text)) return null;
  const amounts = [...text.matchAll(AMOUNT_ANY)].map((m) => m[1].replace(/\.$/, ""));
  if (amounts.length !== 1 || !AMOUNT_OK.test(amounts[0])) return null;
  return { amountMicro: parseUnits(amounts[0], USDC_DECIMALS), kinship: kinshipOf(text) };
}

export function checkAmount(amountMicro: bigint): "ok" | "too-small" | "too-large" {
  if (amountMicro < MIN_SEND_MICRO) return "too-small";
  if (amountMicro > MAX_SEND_MICRO) return "too-large";
  return "ok";
}

export function formatUsdc(amountMicro: bigint): string {
  return formatUnits(amountMicro, USDC_DECIMALS);
}
