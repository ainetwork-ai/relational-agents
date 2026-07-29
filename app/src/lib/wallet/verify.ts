/**
 * Server-side signature verification with viem. Pure crypto — no RPC call, no
 * network, no wallet — so it runs anywhere (route handler, server action, job).
 *
 * Scope: externally-owned accounts (MetaMask and every other keypair wallet).
 * Smart-contract accounts sign via EIP-1271/ERC-6492 and need viem's *action*
 * variants bound to a PublicClient with an RPC — out of scope here.
 */

import {
  getAddress,
  isAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";

export interface VerifyMessageInput {
  /** The exact string the client signed. */
  message: string;
  signature: string;
  /** Address the signature is claimed to come from. */
  address: string;
}

/** Does `signature` prove that `address` signed `message` (EIP-191)? */
export async function verifySignedMessage({
  message,
  signature,
  address,
}: VerifyMessageInput): Promise<boolean> {
  if (!isAddress(address) || !isHexSignature(signature)) return false;
  try {
    return await verifyMessage({
      address: getAddress(address),
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/** Address that signed `message`, or null if the signature is malformed.
 * Use when the flow doesn't know the address up front (address-as-identity). */
export async function recoverSigner(
  message: string,
  signature: string
): Promise<Address | null> {
  if (!isHexSignature(signature)) return null;
  try {
    return await recoverMessageAddress({ message, signature });
  } catch {
    return null;
  }
}

export interface VerifyTypedDataInput {
  typedData: TypedDataDefinition;
  signature: string;
  address: string;
}

/** EIP-712 counterpart of `verifySignedMessage`. */
export async function verifySignedTypedData({
  typedData,
  signature,
  address,
}: VerifyTypedDataInput): Promise<boolean> {
  if (!isAddress(address) || !isHexSignature(signature)) return false;
  try {
    return await verifyTypedData({
      ...typedData,
      address: getAddress(address),
      signature,
    } as Parameters<typeof verifyTypedData>[0]);
  } catch {
    return false;
  }
}

export async function recoverTypedDataSigner(
  typedData: TypedDataDefinition,
  signature: string
): Promise<Address | null> {
  if (!isHexSignature(signature)) return null;
  try {
    return await recoverTypedDataAddress({
      ...typedData,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    return null;
  }
}

/** Case-insensitive address comparison (never compare 0x strings with ===). */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Canonical lowercase form for storage/lookup (matches `users.ainAddress`). */
export function normalizeAddress(address: string): string | null {
  return isAddress(address) ? address.toLowerCase() : null;
}

function isHexSignature(signature: string): signature is Hex {
 // 65 bytes (r + s + v) → 130 hex chars, which is what MetaMask emits. The
 // floor is 128 so EIP-2098 compact signatures still get through to viem;
 // this guard only rejects what is definitely not a signature.
  return /^0x[0-9a-fA-F]{128,}$/.test(signature);
}
