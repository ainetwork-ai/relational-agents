import "server-only";
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { AgentKit, ViemWalletProvider } from "@coinbase/agentkit";

/**
 * AgentKit, wired to the wallet the relationship agent was born with.
 *
 * `provisionRoomAgent` already gives every agent its own key, so the agent
 * does not need a custodial CDP wallet to act — AgentKit's ViemWalletProvider
 * adopts the key it already has. Swapping in CdpEvmWalletProvider later is a
 * one-line change here and nothing downstream moves, which is why every
 * AgentKit call in the app goes through this file.
 */

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

/** Normalizes the stored key (hex, with or without 0x) to a viem private key. */
export function toPrivateKey(stored: string): Hex {
  const hex = stored.startsWith("0x") ? stored.slice(2) : stored;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("agent key is malformed");
  return `0x${hex}` as Hex;
}

export interface AgentWallet {
  /** null when AgentKit could not be loaded — see `via`. */
  agentkit: AgentKit | null;
  provider: ViemWalletProvider | null;
  address: Hex;
  /** Which path actually moves the money, so callers can report it honestly. */
  via: "agentkit" | "viem-fallback";
  /** Present only on the fallback path. */
  walletClient?: ReturnType<typeof createWalletClient>;
}

/** Builds the agent's AgentKit instance from its own private key. */
 // AgentKit ships prebundled code that the production build cannot load while
 // collecting page data (it reaches for a @scure/bip39 subpath its own bundle
 // does not export). Importing it here, at call time rather than module scope,
 // keeps the build out of that code path — the route still gets the real thing.
async function loadAgentKit() {
  return import("@coinbase/agentkit");
}

export async function agentKitFor(storedKey: string): Promise<AgentWallet> {
  const account = privateKeyToAccount(toPrivateKey(storedKey));
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
  const address = account.address.toLowerCase() as Hex;

 // AgentKit's prebundled code asks for a @scure/bip39 subpath that 2.x no
 // longer exports, and in some install layouts that kills the import outright.
 // The agent still has its own key and still owes the seller money, so the
 // spend falls through to viem rather than the demo dying on a packaging bug.
  let loaded: Awaited<ReturnType<typeof loadAgentKit>>;
  try {
    loaded = await loadAgentKit();
  } catch (err) {
    console.error("AgentKit unavailable, paying through viem instead:", err);
    return { agentkit: null, provider: null, address, via: "viem-fallback", walletClient };
  }
  const { AgentKit: Kit, ViemWalletProvider: Provider, walletActionProvider } = loaded;
 // AgentKit pins an older viem than the app, so the two WalletClient types are
 // structurally identical but nominally distinct. The cast crosses that gap.
  const provider = new Provider(
    walletClient as unknown as ConstructorParameters<typeof ViemWalletProvider>[0]
  );
  const agentkit = await Kit.from({
    walletProvider: provider,
    actionProviders: [walletActionProvider()],
  });
  return { agentkit, provider, address, via: "agentkit" };
}

/** Runs one named AgentKit action and returns its result string. */
export async function invokeAction(
  wallet: AgentWallet,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (wallet.agentkit) {
    const action = wallet.agentkit.getActions().find((a) => a.name.endsWith(name));
    if (!action) throw new Error(`AgentKit action ${name} is not available`);
    return action.invoke(args);
  }
 // Fallback: the one action we use, done directly, reported in AgentKit's own
 // sentence shape so everything downstream keeps parsing it the same way.
  if (name !== "native_transfer" || !wallet.walletClient)
    throw new Error(`AgentKit is unavailable and ${name} has no fallback`);
  const to = String(args.to) as Hex;
  const value = String(args.value);
  const hash = await wallet.walletClient.sendTransaction({
    to,
    value: parseEther(value),
    account: wallet.walletClient.account!,
    chain: sepolia,
  });
  return `Transferred ${value} ETH to ${to}\nTransaction hash: ${hash}`;
}

/** AgentKit reports transfers as prose; the tx hash is the last 0x… in it. */
export function txHashFromActionResult(result: string): Hex | null {
  const matches = result.match(/0x[0-9a-fA-F]{64}/g);
  return matches?.length ? (matches[matches.length - 1] as Hex) : null;
}
