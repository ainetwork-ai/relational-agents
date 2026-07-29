import { v4 as uuidv4 } from "uuid";

/** Single source of truth for the sign-in challenge message (used by both
 * challenge generation and signature verification — do not inline). */
export function challengeMessage(nonce: string): string {
  return `Sign in: ${nonce}`;
}

export function generateChallenge(): { nonce: string; message: string } {
  const nonce = uuidv4();
  return { nonce, message: challengeMessage(nonce) };
}

export function verifyAinSignature(
  message: string,
  signature: string,
  address: string
): boolean {
  try {
 // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ain = require("@ainblockchain/ain-js").default;
    const ain = new Ain("https://devnet-api.ainetwork.ai");
    return ain.wallet.verifySignature(message, signature, address);
  } catch {
    return false;
  }
}
