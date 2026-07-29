import "server-only";
import { createWalletClient, http, type Hex } from "viem";
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
  agentkit: AgentKit;
  provider: ViemWalletProvider;
  address: Hex;
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
  const { AgentKit: Kit, ViemWalletProvider: Provider, walletActionProvider } = await loadAgentKit();
  const account = privateKeyToAccount(toPrivateKey(storedKey));
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
 // AgentKit pins an older viem than the app, so the two WalletClient types are
 // structurally identical but nominally distinct. The cast crosses that gap.
  const provider = new Provider(
    walletClient as unknown as ConstructorParameters<typeof ViemWalletProvider>[0]
  );
  const agentkit = await Kit.from({
    walletProvider: provider,
    actionProviders: [walletActionProvider()],
  });
  return { agentkit, provider, address: account.address.toLowerCase() as Hex };
}

/** Runs one named AgentKit action and returns its result string. */
export async function invokeAction(
  agentkit: AgentKit,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const action = agentkit.getActions().find((a) => a.name.endsWith(name));
  if (!action) throw new Error(`AgentKit action ${name} is not available`);
  return action.invoke(args);
}

/** AgentKit reports transfers as prose; the tx hash is the last 0x… in it. */
export function txHashFromActionResult(result: string): Hex | null {
  const matches = result.match(/0x[0-9a-fA-F]{64}/g);
  return matches?.length ? (matches[matches.length - 1] as Hex) : null;
}
