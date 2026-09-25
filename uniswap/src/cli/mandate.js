// Slice-1 stand-in for the signing screen: a member's key signs a standing mandate for the agent.
// Usage: MEMBER_PK=0x… AGENT_PK=0x… pnpm mandate sign [perRunUsdc] [perPeriodUsdc] [days]
//        pnpm mandate revoke <id>
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { ledgerByName } from "../ledger/index.js";
import { mandateTypedData, recoverMandateSigner } from "../mandate/index.js";

const [cmd, a, b, c] = process.argv.slice(2);
const chain = chainByName();
const ledger = ledgerByName();

// One way out for every refused command: the form that would have worked, then why this one did
// not. `form` is the subcommand the operator actually typed — someone revoking does not need the
// sign arguments to find their mistake.
const SIGN = "mandate sign [perRun] [perPeriod] [days]";
const REVOKE = "mandate revoke <id>";
const usage = (form, reason) => {
  console.error(`usage: ${form}${reason ? `  — ${reason}` : ""}`);
  process.exit(2);
};

if (cmd === "sign") {
  const member = privateKeyToAccount(process.env.MEMBER_PK);
  const agent = privateKeyToAccount(process.env.AGENT_PK);
  const d = chain.tokens.USDC.decimals;
  // The caps are the two numbers a person types, so they are judged here, before a signature makes
  // them unamendable. Read as a float they would not be: `0.07 * 10 ** 6` is 70000.00000000001, and
  // rounding hides that while still signing a cap the family never typed. `parseUnits` reads the
  // decimal string in USDC's own units, and refuses "abc" instead of signing NaN.
  const cap = (value, what) => {
    let amount;
    try { amount = parseUnits(value, d); } catch { usage(SIGN, `${what} "${value}" is not a decimal amount`); }
    if (amount <= 0n) usage(SIGN, `${what} must be positive`);
    return amount;
  };
  const m = {
    id: `m-${Date.now()}`, roomId: process.env.ROOM_ID ?? "room-demo", agent: agent.address, kind: "standing",
    tokenIn: chain.tokens.USDC.address, tokenOut: chain.tokens.WETH.address,
    perRunCap: cap(a ?? "20", "perRun"),
    perPeriodCap: cap(b ?? "100", "perPeriod"),
    period: process.env.TSUMITATE_PERIOD ?? "week",
    expiresAt: Math.floor(Date.now() / 1000) + Number(c ?? "90") * 86_400, nonce: Date.now(),
  };
  const signature = await member.signTypedData(mandateTypedData(m, chain.chainId));
  const signer = await recoverMandateSigner(m, chain.chainId, signature);
  m.approval = { method: "wallet-signature", subject: signer, verifiedAt: Math.floor(Date.now() / 1000), ref: signature };
  await ledger.addMandate(m);
  console.log(JSON.stringify({ ...m, perRunCap: m.perRunCap.toString(), perPeriodCap: m.perPeriodCap.toString() }, null, 2));
} else if (cmd === "revoke") {
  try {
    await ledger.revoke(a, Math.floor(Date.now() / 1000));
  } catch (err) {
    // Only the ledger's "that id is not here". An unreadable or unwritable passbook is not the
    // operator's typo and keeps its stack trace: told "no mandate", they would go on checking what
    // they typed while the file is the problem. The wording is the coupling between the two files,
    // and test/cli.test.js is what holds it — a renamed message rethrows and the test sees exit 1.
    if (!/^no mandate /.test(String(err?.message))) throw err;
    usage(REVOKE, `no mandate "${a}"`);
  }
  console.log(JSON.stringify({ revoked: a }));
} else {
  usage(`${SIGN} | ${REVOKE}`);
}
