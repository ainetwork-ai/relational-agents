/**
 * The member's own wallet on Base for a recurring contribution: connect, switch to Base, send one
 * call and wait for it. Everything goes through the injected provider (lib/wallet/provider.ts), so
 * receipts come from the wallet's own node, not a public RPC a block behind. The calls are
 * contribution-plan.ts's; the amounts are the plan's own, never unlimited.
 */

import { createPublicClient, createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { base } from "viem/chains";
import type { T } from "@/i18n/translate";
import { getInjectedProvider } from "@/lib/wallet/provider";

const BASE_HEX = "0x2105";
const BASE_PARAMS = {
  chainId: BASE_HEX,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export type WalletFailure = "no-wallet" | "no-account" | "rejected" | "wrong-chain" | "reverted" | "other";

export class ContributionWalletError extends Error {
  constructor(
    readonly kind: WalletFailure,
    message: string
  ) {
    super(message);
  }
}

function codeOf(err: unknown, depth = 0): number | string | null {
  if (!err || typeof err !== "object" || depth > 4) return null;
  const e = err as { code?: unknown; cause?: unknown; name?: unknown };
  if (e.name === "UserRejectedRequestError") return 4001;
  if (typeof e.code === "number" || typeof e.code === "string") return e.code;
  return codeOf(e.cause, depth + 1);
}

/** What went wrong, in the shape the dialogs branch on. */
export function walletFailure(err: unknown): ContributionWalletError {
  if (err instanceof ContributionWalletError) return err;
  const code = codeOf(err);
  if (code === 4001 || code === "ACTION_REJECTED") return new ContributionWalletError("rejected", "rejected");
  const short = (err as { shortMessage?: unknown })?.shortMessage;
  const text = typeof short === "string" ? short : err instanceof Error ? err.message : String(err);
  return new ContributionWalletError("other", text.split("\n")[0].slice(0, 160));
}

/** One line for the member. Wallet and viem messages are English and short — safe to show as the reason. */
export function failureText(t: T, err: ContributionWalletError): string {
  switch (err.kind) {
    case "no-wallet":
      return t("No wallet in this browser — install MetaMask to continue.");
    case "no-account":
      return t("Your wallet shared no account — unlock it and try again.");
    case "rejected":
      return t("You declined it in your wallet.");
    case "wrong-chain":
      return t("Switch your wallet to Base to continue.");
    case "reverted":
      return t("It reverted on Base — nothing moved.");
    default:
      return t("Your wallet couldn't send it: {why}", { why: err.message });
  }
}

export interface BaseWallet {
  address: `0x${string}`;
  wallet: ReturnType<typeof walletFor>;
  client: ReturnType<typeof clientFor>;
}

const walletFor = (provider: EIP1193Provider, address: `0x${string}`) => createWalletClient({ account: address, chain: base, transport: custom(provider) });
const clientFor = (provider: EIP1193Provider) => createPublicClient({ chain: base, transport: custom(provider) });

/** Ask for the member's account and put the wallet on Base, adding the network when the wallet lacks it. */
export async function connectBase(): Promise<BaseWallet> {
  const injected = getInjectedProvider();
  if (!injected) throw new ContributionWalletError("no-wallet", "no wallet");
  const provider = injected as unknown as EIP1193Provider;
  let accounts: string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  } catch (err) {
    throw walletFailure(err);
  }
  const address = accounts?.[0] as `0x${string}` | undefined;
  if (!address) throw new ContributionWalletError("no-account", "no account");
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId.toLowerCase() !== BASE_HEX) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_HEX }] });
    } catch (err) {
      // 4902: the wallet doesn't know Base yet
      if (codeOf(err) !== 4902) throw codeOf(err) === 4001 ? walletFailure(err) : new ContributionWalletError("wrong-chain", "wrong chain");
      try {
        await provider.request({ method: "wallet_addEthereumChain", params: [BASE_PARAMS] });
      } catch (addErr) {
        throw walletFailure(addErr);
      }
    }
    const now = (await provider.request({ method: "eth_chainId" })) as string;
    if (now.toLowerCase() !== BASE_HEX) throw new ContributionWalletError("wrong-chain", "wrong chain");
  }
  return { address, wallet: walletFor(provider, address), client: clientFor(provider) };
}

/** Wait for a sent call; a revert is a failure the member sees, with nothing moved. */
export async function mined(w: BaseWallet, hash: Hex): Promise<void> {
  const receipt = await w.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new ContributionWalletError("reverted", "reverted");
}
