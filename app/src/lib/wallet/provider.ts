/**
 * Browser-side wallet plumbing: find the injected EIP-1193 provider
 * (MetaMask & friends) and wrap it in a viem WalletClient.
 *
 * Signing-only by design — no chain is pinned and no RPC transport is used,
 * because `personal_sign` / `eth_signTypedData_v4` are wallet-local operations.
 * The wallet's own selected network is irrelevant to an EIP-191 signature.
 */

import { createWalletClient, custom, type EIP1193Provider } from "viem";

/** Minimal EIP-1193 surface as injected by browser wallets. This is the single
 *  source of truth for `window.ethereum`'s type across the app — the global
 *  augmentation below is the only one; don't re-declare it elsewhere. */
export interface InjectedEthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  /** Legacy multi-wallet shim: some extensions expose every injected provider here. */
  providers?: InjectedEthereumProvider[];
}

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
  }
}

// Note: the MetaMask sign-in flow in components/login-form.tsx predates this
// module and still calls `window.ethereum.request` by hand (own hex encoding,
// own error mapping). It works; it can be swapped to `signMessageWithWallet`
// from ./sign whenever that flow is next touched.

/** Why a signature request failed, in the shape a UI needs to branch on. */
export type WalletErrorReason =
  | "no-provider" // no wallet extension in this browser
  | "no-account" // wallet present but unlocked/authorised no account
  | "rejected" // user clicked "Reject" in the wallet popup
  | "failed"; // anything else (provider error, bad params, …)

export class WalletSignatureError extends Error {
  readonly reason: WalletErrorReason;

  constructor(reason: WalletErrorReason, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WalletSignatureError";
    this.reason = reason;
  }
}

/** EIP-6963 announcement payload (the parts we read). */
interface Eip6963Detail {
  info?: { rdns?: string };
  provider?: InjectedEthereumProvider;
}

/** Collect EIP-6963 providers. Wallets answer `requestProvider` synchronously
 *  within the dispatch, so this is safe to call from a click handler. */
function discoverEip6963(): Eip6963Detail[] {
  const found: Eip6963Detail[] = [];
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<Eip6963Detail>).detail;
    if (d?.provider) found.push(d);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  return found;
}

/** True only for the real MetaMask — Coinbase Wallet also sets `isMetaMask`. */
const isRealMetaMask = (p: InjectedEthereumProvider | undefined) =>
  !!p?.isMetaMask && !p.isCoinbaseWallet;

/**
 * Find the wallet the "Sign in with MetaMask" button should talk to.
 *
 * With several extensions installed, whichever injected last owns
 * `window.ethereum` (Coinbase is aggressive about this), so preferring
 * MetaMask needs explicit discovery: EIP-6963 by rdns first, then the legacy
 * `providers` array, then `window.ethereum` itself. Falls back to any injected
 * provider so single-wallet non-MetaMask users can still sign in.
 */
export function getInjectedProvider(): InjectedEthereumProvider | null {
  if (typeof window === "undefined") return null;
  const announced = discoverEip6963();
  const byRdns = announced.find((d) => d.info?.rdns === "io.metamask")?.provider;
  if (byRdns) return byRdns;
  const eth = window.ethereum;
  const legacyMm = eth?.providers?.find(isRealMetaMask);
  if (legacyMm) return legacyMm;
  if (eth && isRealMetaMask(eth)) return eth;
  return announced[0]?.provider ?? eth ?? null;
}

export function isWalletAvailable(): boolean {
  return getInjectedProvider() !== null;
}

// One client per provider object: cheap to build, but caching keeps identity
// stable for callers that memoise on it. Re-created if the page swaps
// providers (multi-wallet extensions do this on user selection).
let cached: {
  provider: InjectedEthereumProvider;
  client: ReturnType<typeof createWalletClient>;
} | null = null;

/** viem WalletClient over the injected provider. Throws `no-provider` if
 *  there is no wallet to talk to. */
export function getWalletClient() {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new WalletSignatureError(
      "no-provider",
      "No Ethereum wallet detected. Install MetaMask to continue."
    );
  }
  if (cached?.provider !== provider) {
    cached = {
      provider,
      // viem's EIP1193Provider is a strictly-typed superset of the loose shape
      // we declare for `window.ethereum`; only `request` is actually used.
      client: createWalletClient({
        transport: custom(provider as unknown as EIP1193Provider),
      }),
    };
  }
  return cached.client;
}

/** Normalise anything thrown by viem/the provider into a WalletSignatureError. */
export function toWalletError(err: unknown): WalletSignatureError {
  if (err instanceof WalletSignatureError) return err;

  // EIP-1193 rejection is 4001; viem nests the original error, so walk `cause`.
  if (hasRejectionCode(err)) {
    return new WalletSignatureError(
      "rejected",
      "Signature request was rejected in the wallet.",
      err
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new WalletSignatureError("failed", message || "Wallet request failed", err);
}

function hasRejectionCode(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; name?: unknown; cause?: unknown };
  if (e.code === 4001 || e.code === "ACTION_REJECTED") return true;
  if (e.name === "UserRejectedRequestError") return true;
  return hasRejectionCode(e.cause, depth + 1);
}
