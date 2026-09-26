// ens/src/prepare.ts
// From "send Minjun 20 USDC" to one of: refuse (with a reason), ask (who?), or ready
// (with the unsigned USDC.transfer). Used by the app's agent skill and the MCP server.
// It never signs and never sends.
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { SEPOLIA_CHAIN_ID, SEPOLIA_USDC } from "./config";
import { checkAmount, parseSendRequest } from "./send-request";
import { findNodeByAddress, pickRecipients, type FamilyNode } from "./family-tree";
import type { FamilyChain } from "./chain";

export type RefuseReason = "no-request" | "too-small" | "too-large" | "not-in-family" | "nobody" | "unverified";

export type PrepareResult =
  | { kind: "refuse"; reason: RefuseReason; name?: string }
  | { kind: "ask"; candidates: FamilyNode[] }
  | {
      kind: "ready";
      asker: FamilyNode;
      recipient: FamilyNode;
      to: Address;
      amountMicro: bigint;
      tx: { chainId: number; to: Address; data: Hex; value: bigint };
    };

export async function prepareSend(
  input: { text: string; askerAddress: string; tree: FamilyNode; nicknames?: Map<string, string[]> },
  chain: Pick<FamilyChain, "verifyPath" | "resolveAddress">
): Promise<PrepareResult> {
  const req = parseSendRequest(input.text);
  if (!req) return { kind: "refuse", reason: "no-request" };
  const amount = checkAmount(req.amountMicro);
  if (amount !== "ok") return { kind: "refuse", reason: amount };

  const asker = findNodeByAddress(input.tree, input.askerAddress);
  if (!asker) return { kind: "refuse", reason: "not-in-family" };

  const picks = pickRecipients(asker, { kinship: req.kinship, text: input.text, nicknames: input.nicknames });
  if (picks.length === 0) return { kind: "refuse", reason: "nobody" };
  if (picks.length > 1) return { kind: "ask", candidates: picks };

  const [recipient] = picks;
  const [pathOk, to] = await Promise.all([chain.verifyPath(recipient.name), chain.resolveAddress(recipient.name)]);
  if (!pathOk || !to) return { kind: "refuse", reason: "unverified", name: recipient.name };

  return {
    kind: "ready",
    asker,
    recipient,
    to,
    amountMicro: req.amountMicro,
    tx: {
      chainId: SEPOLIA_CHAIN_ID,
      to: SEPOLIA_USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, req.amountMicro] }),
      value: 0n,
    },
  };
}
