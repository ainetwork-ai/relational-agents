/**
 * "Just get me a signature" primitives — flow-agnostic on purpose.
 *
 * These do NOT log anyone in, create a session, or touch the DB: they ask the
 * user's wallet to sign something and hand the result back. Drop them into
 * whatever flow needs proof-of-key-ownership (login, page approval, sharing a
 * doc, signing an agent action, …) and verify server-side with `./verify`.
 *
 * Client-side only (needs `window.ethereum`).
 */

import type { Address, Hex, TypedDataDefinition } from "viem";
import {
  getWalletClient,
  toWalletError,
  WalletSignatureError,
} from "./provider";

export interface WalletSignature {
  /** Address that produced the signature (as the wallet reports it). */
  address: Address;
  /** 65-byte r+s+v signature, 0x-prefixed. */
  signature: Hex;
}

export interface SignedMessage extends WalletSignature {
  /** Exactly the string that was signed — send it to the verifier verbatim. */
  message: string;
}

export interface SignedTypedData extends WalletSignature {
  /** The EIP-712 payload that was signed. */
  typedData: TypedDataDefinition;
}

/**
 * Prompt the wallet for account access and return the selected address.
 * Idempotent from the user's point of view: once authorised, the wallet
 * answers without a popup.
 */
export async function connectWallet(): Promise<Address> {
  const client = getWalletClient();
  try {
    const [address] = await client.requestAddresses();
    if (!address) {
      throw new WalletSignatureError(
        "no-account",
        "No account available. Unlock your wallet and try again."
      );
    }
    return address;
  } catch (err) {
    throw toWalletError(err);
  }
}

/**
 * Already-authorised address, or null. Never prompts — safe to call on mount
 * to decide whether to render "Connect" or "Sign".
 */
export async function getConnectedAddress(): Promise<Address | null> {
  try {
    const [address] = await getWalletClient().getAddresses();
    return address ?? null;
  } catch {
    return null;
  }
}

/**
 * EIP-191 `personal_sign`. viem does the utf8 → hex encoding and the
 * "\x19Ethereum Signed Message:\n<len>" framing for us.
 *
 * Pass `address` to sign with a specific account; omit it to use whatever the
 * wallet has selected (prompting for access if needed).
 */
export async function signMessageWithWallet(
  message: string,
  opts: { address?: Address } = {}
): Promise<SignedMessage> {
  const client = getWalletClient();
  const address = opts.address ?? (await connectWallet());
  try {
    const signature = await client.signMessage({ account: address, message });
    return { address, signature, message };
  } catch (err) {
    throw toWalletError(err);
  }
}

/**
 * EIP-712 `eth_signTypedData_v4`. Prefer this over a plain message whenever the
 * thing being signed has structure (an action, an amount, a document hash):
 * the wallet renders the fields, so the user sees what they approve.
 */
export async function signTypedDataWithWallet(
  typedData: TypedDataDefinition,
  opts: { address?: Address } = {}
): Promise<SignedTypedData> {
  const client = getWalletClient();
  const address = opts.address ?? (await connectWallet());
  try {
    const signature = await client.signTypedData({
      account: address,
      ...typedData,
    } as Parameters<typeof client.signTypedData>[0]);
    return { address, signature, typedData };
  } catch (err) {
    throw toWalletError(err);
  }
}

/** Chain the wallet is currently on. Only needed if a flow cares (EIP-712
 *  domains, on-chain follow-ups); plain message signing does not. */
export async function getWalletChainId(): Promise<number> {
  try {
    return await getWalletClient().getChainId();
  } catch (err) {
    throw toWalletError(err);
  }
}
