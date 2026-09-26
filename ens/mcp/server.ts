#!/usr/bin/env node
// ens/mcp/server.ts — pocket money by name, for any MCP client (Claude Code, a judge's laptop).
// Reads Sepolia and prepares unsigned transfers; it holds no keys and never signs.
//
//   claude mcp add ens-family --env ENS_FAMILY_ROOT=kim.ainmem.eth --env ENS_FAMILY_FROM_BLOCK=… \
//     -- npx tsx /mnt/newdata/git/relational-agents/ens/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseUnits, type Address, type Hex } from "viem";
import { z } from "zod";
import { createFamilyChain } from "../src/chain";
import { displayName, type FamilyNode } from "../src/family-tree";
import { prepareSend } from "../src/prepare";
import { formatUsdc } from "../src/send-request";
import { USDC_DECIMALS } from "../src/config";

const root = process.env.ENS_FAMILY_ROOT;
if (!root) {
  console.error("ENS_FAMILY_ROOT is required");
  process.exit(1);
}
const chain = createFamilyChain({ root, rpcUrl: process.env.SEPOLIA_RPC, fromBlock: BigInt(process.env.ENS_FAMILY_FROM_BLOCK ?? "0") });

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }],
});
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] });
const strip = (n: FamilyNode): unknown => ({ name: n.name, alias: n.alias, relation: n.relation, address: n.address, children: n.children.map(strip) });
const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const server = new McpServer({ name: "ens-family", version: "0.1.0" });

server.tool("ens_family_tree", `The ${root} family tree as ENSv2 names on Sepolia (alias, relation, address per person).`, {}, async () => {
  try {
    return text(strip(await chain.loadTree()));
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  "ens_prepare_send",
  "Prepare 'send <name or relation> <amount> USDC' for the person with asker_address. Returns refuse / ask / ready; ready carries an UNSIGNED Sepolia USDC.transfer for the asker's own wallet to sign.",
  { asker_address: ADDRESS, request: z.string().min(1) },
  async ({ asker_address, request }) => {
    try {
      const r = await prepareSend({ text: request, askerAddress: asker_address, tree: await chain.loadTree() }, chain);
      if (r.kind === "ready")
        return text({ kind: "ready", recipient: r.recipient.name, display: displayName(r.recipient), to: r.to, amount_usdc: formatUsdc(r.amountMicro), unsigned_tx: r.tx });
      if (r.kind === "ask") return text({ kind: "ask", candidates: r.candidates.map((c) => ({ name: c.name, display: displayName(c) })) });
      return text(r);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "ens_verify_transfer",
  "Check that a Sepolia transaction moved exactly amount_usdc USDC from `from` to `to`.",
  { tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), from: ADDRESS, to: ADDRESS, amount_usdc: z.string().regex(/^\d+(\.\d{1,6})?$/) },
  async (a) => {
    try {
      const ok = await chain.findTransfer(a.tx_hash as Hex, { from: a.from as Address, to: a.to as Address, amountMicro: parseUnits(a.amount_usdc, USDC_DECIMALS) });
      return text({ ok });
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());
