/**
 * The payer's side of an x402 v2 "exact" EIP-3009 payment, signed in the
 * browser wallet: from a 402's PAYMENT-REQUIRED to the PAYMENT-SIGNATURE value
 * that pays it. Same payload @x402/evm's client builds — the wallet shows the
 * USDC transfer (to, amount) as typed data, and the facilitator that settles
 * it moves the money from this wallet.
 */

import type { Address, Hex } from "viem";
import { connectWallet, signTypedDataWithWallet } from "./sign";

export interface X402Requirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** Signs the first EVM "exact"/EIP-3009 option of `paymentRequired` (the
 *  header's base64 value) and returns the PAYMENT-SIGNATURE header value. */
export async function payX402WithWallet(paymentRequired: string): Promise<{ header: string; from: Address }> {
  const required = JSON.parse(unb64(paymentRequired)) as { x402Version: number; resource?: unknown; accepts: X402Requirements[] };
  const req = required.accepts.find((r) => r.scheme === "exact" && r.network.startsWith("eip155:") && r.extra?.assetTransferMethod !== "permit2");
  if (!req) throw new Error("no wallet-signable payment option in the 402");
  const chainId = Number(req.network.split(":")[1]);
  const from = await connectWallet();
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to: req.payTo as Address,
    value: req.amount,
    validAfter: String(now - 600),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex,
  };
  const { signature } = await signTypedDataWithWallet(
    {
      domain: { name: String(req.extra?.name), version: String(req.extra?.version), chainId, verifyingContract: req.asset as Address },
      types: AUTH_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        ...authorization,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
      },
    },
    { address: from }
  );
  const payload = { x402Version: required.x402Version, payload: { authorization, signature }, resource: required.resource, accepted: req };
  return { header: b64(JSON.stringify(payload)), from };
}
