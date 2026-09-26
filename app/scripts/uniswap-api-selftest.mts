// The Base buy through the Uniswap Trading API (uniswap-api.ts): each routing's flow, and when it
// may and may not fall back to the direct path. fetch and the chain are mocks — no network.
// The answers are the shapes /check_approval and /quote returned on Base on 2026-09-27.
//   cd app && npx tsx --tsconfig scripts/tsconfig.json scripts/uniswap-api-selftest.mts
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, maxUint256, parseAbi, recoverTypedDataAddress, type Hex, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buyWethWithUsdc,
  failureMarks,
  TRADING_API,
  type BuyRequest,
  type SwapFill,
  type SwapTx,
  type SwapWallet,
  type TypedDataToSign,
} from "@/lib/agent/treasury/uniswap-api";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
// a well-known test key (Hardhat's first account): it signs here and nowhere else
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const AGENT = account.address;
const OTHER = "0x00000000000000000000000000000000000000b0" as const;

const SMALL: BuyRequest = { chainId: 8453, usdc: USDC, weth: WETH, amountIn: BigInt(100_000), slippageBps: 50, allowOrders: false };
const LARGE: BuyRequest = { ...SMALL, amountIn: BigInt(1_000_000_000), allowOrders: true };

const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const DIRECT_TX = hashOf(0xd1);
const FILL_TX = hashOf(0xf1);
const ORDER_ID = "0x3e491638814697eac9bc0296162596f2e757642b4e5dabeb0a633023dd6e0a96" as Hex;

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function transferLog(token: string, from: string, to: string, value: bigint): Log {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20, eventName: "Transfer", args: { from: from as Hex, to: to as Hex } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  } as unknown as Log;
}

// ── the API's answers ───────────────────────────────────────────────────────

const approvalTx = {
  to: USDC,
  from: AGENT,
  data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [TRADING_API.permit2, maxUint256] }),
  value: "0x00",
  chainId: 8453,
};

const classicQuote = (over: Record<string, unknown> = {}) => ({
  requestId: "a9395818b2c0a3c3c103326d08594ebf",
  routing: "CLASSIC",
  isTokenApprovalApplicable: true,
  permitTransaction: null,
  permitData: {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: TRADING_API.permit2 },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    values: {
      details: { token: USDC, amount: "100000", expiration: "1793042793", nonce: "0" },
      spender: TRADING_API.universalRouter,
      sigDeadline: "1790452593",
    },
  },
  quote: {
    chainId: 8453,
    swapper: AGENT,
    tradeType: "EXACT_INPUT",
    input: { amount: "100000", token: USDC, maximumAmount: "100000" },
    output: { amount: "37250241256197", token: WETH, recipient: AGENT, minimumAmount: "37063990049916" },
    routeString: "[v3] 100.00% = [0.01%] 0xb4CB800910B228ED3d0834cF79D697127BBB00e5",
  },
  ...over,
});

const swapAnswer = (over: Record<string, unknown> = {}) => ({
  requestId: "swap-request",
  swap: { to: TRADING_API.universalRouter, from: AGENT, data: `0x3593564c${"00".repeat(96)}`, value: "0x00", chainId: 8453, gasLimit: "180000", ...over },
});

const dutchQuote = (over: Record<string, unknown> = {}) => ({
  requestId: "dutch-request",
  routing: "DUTCH_V3",
  isTokenApprovalApplicable: true,
  permitTransaction: null,
  permitData: {
    domain: { name: "Permit2", chainId: 8453, verifyingContract: TRADING_API.permit2.toLowerCase() },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "V3DutchOrder" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      V3DutchOrder: [
        { name: "info", type: "OrderInfo" },
        { name: "cosigner", type: "address" },
        { name: "startingBaseFee", type: "uint256" },
        { name: "baseInput", type: "V3DutchInput" },
        { name: "baseOutputs", type: "V3DutchOutput[]" },
      ],
      OrderInfo: [
        { name: "reactor", type: "address" },
        { name: "swapper", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "additionalValidationContract", type: "address" },
        { name: "additionalValidationData", type: "bytes" },
      ],
      V3DutchInput: [
        { name: "token", type: "address" },
        { name: "startAmount", type: "uint256" },
        { name: "curve", type: "NonlinearDutchDecay" },
        { name: "maxAmount", type: "uint256" },
        { name: "adjustmentPerGweiBaseFee", type: "uint256" },
      ],
      V3DutchOutput: [
        { name: "token", type: "address" },
        { name: "startAmount", type: "uint256" },
        { name: "curve", type: "NonlinearDutchDecay" },
        { name: "recipient", type: "address" },
        { name: "minAmount", type: "uint256" },
        { name: "adjustmentPerGweiBaseFee", type: "uint256" },
      ],
      NonlinearDutchDecay: [
        { name: "relativeBlocks", type: "uint256" },
        { name: "relativeAmounts", type: "int256[]" },
      ],
    },
    values: {
      permitted: { token: USDC, amount: "1000000000" },
      spender: TRADING_API.reactors.DUTCH_V3,
      nonce: "1993350550946401718512246810507244567642594657646676584675523451570127625473",
      deadline: 1790451094,
      witness: {
        info: {
          reactor: TRADING_API.reactors.DUTCH_V3,
          swapper: AGENT,
          nonce: "1993350550946401718512246810507244567642594657646676584675523451570127625473",
          deadline: 1790451094,
          additionalValidationContract: "0x0000000000000000000000000000000000000000",
          additionalValidationData: "0x",
        },
        cosigner: "0x4449Cd34d1eb1FEDCF02A1Be3834FfDe8E6A6180",
        startingBaseFee: "0",
        baseInput: { token: USDC, startAmount: "1000000000", curve: { relativeBlocks: "4", relativeAmounts: ["0"] }, maxAmount: "1000000000", adjustmentPerGweiBaseFee: "0" },
        baseOutputs: [
          {
            token: WETH,
            startAmount: "371614389724705490",
            curve: { relativeBlocks: "4", relativeAmounts: ["1858071948623527"] },
            recipient: AGENT,
            minAmount: "369756317776081963",
            adjustmentPerGweiBaseFee: "0",
          },
        ],
      },
    },
  },
  quote: { orderId: ORDER_ID, encodedOrder: "0x00", orderInfo: { reactor: TRADING_API.reactors.DUTCH_V3, swapper: AGENT } },
  ...over,
});

const orders = (status: string, extra: Record<string, unknown> = {}) => ({ requestId: "orders", orders: [{ orderId: ORDER_ID, orderStatus: status, ...extra }] });

// ── mocks ───────────────────────────────────────────────────────────────────

type Answer = { status?: number; json: unknown } | "no answer";
interface Call {
  path: string;
  body?: Record<string, unknown>;
  query: URLSearchParams;
  headers: Record<string, string>;
}

/** fetch answering per path; a list answers in turn and repeats its last. A path with no answer fails like a dropped connection. */
function api(answers: Record<string, Answer | Answer[]>) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  const fetch = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined, query: url.searchParams, headers: init?.headers as Record<string, string> });
    const list = answers[path];
    const i = (seen[path] = (seen[path] ?? -1) + 1);
    const answer = Array.isArray(list) ? list[Math.min(i, list.length - 1)] : list;
    if (!answer || answer === "no answer") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.json), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, paths: () => calls.map((c) => c.path) };
}

/** The agent's wallet: real signatures from the test key, sends recorded, receipts from `receipts`. */
function chain(receipts: Record<string, { status: "success" | "reverted"; logs: Log[] } | Error> = {}) {
  const sent: SwapTx[] = [];
  const signed: { typedData: TypedDataToSign; signature: Hex }[] = [];
  let clock = 0;
  const wallet: SwapWallet = {
    address: AGENT,
    signTypedData: async (typedData) => {
      const signature = await account.signTypedData(typedData);
      signed.push({ typedData, signature });
      return signature;
    },
    sendTransaction: async (tx) => {
      sent.push(tx);
      return hashOf(sent.length);
    },
    waitForReceipt: async (hash) => {
      const r = receipts[hash] ?? { status: "success" as const, logs: [] };
      if (r instanceof Error) throw r;
      return r;
    },
    allowance: async () => maxUint256,
  };
  return { wallet, sent, signed, sleep: async (ms: number) => void (clock += ms), now: () => clock, elapsed: () => clock };
}

/** WETH to the agent, plus a transfer to someone else the fill must not count. */
const fillLogs = (weth: bigint) => [transferLog(USDC, AGENT, OTHER, BigInt(100_000)), transferLog(WETH, OTHER, AGENT, weth), transferLog(WETH, OTHER, OTHER, BigInt(5))];

async function buy(request: BuyRequest, apiKey: string | null, a: ReturnType<typeof api>, c: ReturnType<typeof chain>) {
  let directCalls = 0;
  const run = buyWethWithUsdc({
    request,
    apiKey,
    api: { fetch: a.fetch, wallet: c.wallet, sleep: c.sleep, now: c.now },
    direct: async () => {
      directCalls++;
      return { txHash: DIRECT_TX, wethOut: BigInt(37_246) };
    },
  });
  const settled = await run.then(
    (fill) => ({ fill, err: undefined }),
    (err: unknown) => ({ fill: undefined as SwapFill | undefined, err })
  );
  return { ...settled, directCalls: () => directCalls };
}

// ── the checks ──────────────────────────────────────────────────────────────

await check("no key: the direct path, and the API is never asked", async () => {
  const a = api({});
  const c = chain();
  const r = await buy(SMALL, null, a, c);
  assert.deepEqual(r.fill, { txHash: DIRECT_TX, usdcIn: BigInt(100_000), wethOut: BigInt(37_246), route: "direct v3" });
  assert.equal(r.directCalls(), 1);
  assert.equal(a.calls.length, 0);
  assert.equal(c.sent.length, 0);
});

await check("CLASSIC: approval, permit, /swap, the Universal Router transaction; the fill from its receipt", async () => {
  const a = api({ "/check_approval": { json: { requestId: "r0", approval: approvalTx, cancel: null } }, "/quote": { json: classicQuote() }, "/swap": { json: swapAnswer() } });
  const c = chain({ [hashOf(2)]: { status: "success", logs: fillLogs(BigInt("37250241256197")) } });
  const r = await buy(SMALL, "test-key", a, c);
  assert.equal(r.err, undefined);
  assert.deepEqual(r.fill, { txHash: hashOf(2), usdcIn: BigInt(100_000), wethOut: BigInt("37250241256197"), route: "uniswap-api CLASSIC", requestId: "a9395818b2c0a3c3c103326d08594ebf" });
  assert.equal(r.directCalls(), 0);
  assert.deepEqual(a.paths(), ["/check_approval", "/quote", "/swap"]);
  // every call pins the router version and carries the key
  for (const call of a.calls) {
    assert.equal(call.headers["x-universal-router-version"], "2.1.2");
    assert.equal(call.headers["x-api-key"], "test-key");
  }
  const quoted = a.calls[1].body!;
  assert.deepEqual(
    [quoted.type, quoted.amount, quoted.swapper, quoted.slippageTolerance, quoted.permitAmount, quoted.protocols],
    ["EXACT_INPUT", "100000", AGENT, 0.5, "EXACT", ["V2", "V3", "V4"]]
  );
  // the approval first, then the swap to the pinned router, with an explicit gas limit
  assert.equal(c.sent.length, 2);
  assert.equal(c.sent[0].to, USDC);
  assert.equal(c.sent[1].to, TRADING_API.universalRouter);
  assert.equal(c.sent[1].gas, BigInt(400_000));
  // /swap got the signature with its permitData, and the signature is the agent's over that permit
  const swapped = a.calls[2].body!;
  assert.deepEqual(swapped.permitData, classicQuote().permitData);
  assert.equal(c.signed.length, 1);
  assert.equal(c.signed[0].typedData.primaryType, "PermitSingle");
  assert.equal(swapped.signature, c.signed[0].signature);
  assert.equal(await recoverTypedDataAddress({ ...c.signed[0].typedData, signature: c.signed[0].signature }), AGENT);
});

await check("CLASSIC with the allowance in place and no permit to sign: /swap gets the quote alone", async () => {
  const a = api({ "/check_approval": { json: { requestId: "r0", approval: null, cancel: null } }, "/quote": { json: classicQuote({ permitData: null }) }, "/swap": { json: swapAnswer({ gasLimit: "900000" }) } });
  const c = chain({ [hashOf(1)]: { status: "success", logs: fillLogs(BigInt(7)) } });
  const r = await buy(SMALL, "test-key", a, c);
  assert.equal(r.fill?.route, "uniswap-api CLASSIC");
  assert.deepEqual(Object.keys(a.calls[2].body!), ["quote"]);
  assert.equal(c.sent.length, 1);
  assert.equal(c.sent[0].gas, BigInt(900_000)); // the API's limit when it is the larger
});

await check("UniswapX (DUTCH_V3): the order signed, handed to /order, polled until filled; the fill from the fill transaction", async () => {
  const a = api({
    "/check_approval": { json: { requestId: "r0", approval: null, cancel: null } },
    "/quote": { json: dutchQuote() },
    "/order": { status: 201, json: { requestId: "order-request", orderId: ORDER_ID, orderStatus: "open" } },
    "/orders": [{ json: orders("open") }, "no answer", { json: orders("filled", { txHash: FILL_TX }) }],
  });
  const c = chain({ [FILL_TX]: { status: "success", logs: fillLogs(BigInt("371614389724705490")) } });
  const r = await buy(LARGE, "test-key", a, c);
  assert.equal(r.err, undefined);
  assert.deepEqual(r.fill, { txHash: FILL_TX, usdcIn: BigInt(1_000_000_000), wethOut: BigInt("371614389724705490"), route: "uniswap-api UniswapX", requestId: "dutch-request" });
  assert.equal(r.directCalls(), 0);
  assert.equal(c.sent.length, 0); // an order sends nothing from the agent: a filler does
  assert.deepEqual(a.paths(), ["/check_approval", "/quote", "/order", "/orders", "/orders", "/orders"]);
  assert.equal(a.calls[1].body!.protocols, undefined); // a caller that can hold an open order lets the API choose among all
  assert.equal(a.calls[3].query.get("orderId"), ORDER_ID);
  const ordered = a.calls[2].body!;
  assert.equal(ordered.routing, "DUTCH_V3");
  assert.deepEqual(ordered.quote, dutchQuote().quote);
  assert.equal(c.signed[0].typedData.primaryType, "PermitWitnessTransferFrom");
  assert.equal(ordered.signature, c.signed[0].signature);
  assert.equal(await recoverTypedDataAddress({ ...c.signed[0].typedData, signature: c.signed[0].signature }), AGENT);
});

await check("an API error before anything is sent: the direct path in the same run, and why", async () => {
  const notFound = { status: 404, json: { errorCode: "NoRouteFoundError", detail: "No quotes available" } };
  for (const [answers, reason] of [
    [{ "/check_approval": { json: { approval: null, cancel: null } }, "/quote": notFound }, "/quote answered 404 NoRouteFoundError"],
    [{ "/check_approval": "no answer" }, "/check_approval did not answer"],
    [{ "/check_approval": { json: { approval: null, cancel: null } }, "/quote": { json: classicQuote() }, "/swap": { status: 500, json: {} } }, "/swap answered 500"],
  ] as const) {
    const a = api(answers as Record<string, Answer>);
    const c = chain();
    const r = await buy(SMALL, "test-key", a, c);
    assert.equal(r.err, undefined);
    assert.equal(r.fill?.route, "direct v3");
    assert.equal(r.fill?.fallbackReason, reason);
    assert.equal(r.directCalls(), 1);
    assert.equal(c.sent.length, 0);
  }
});

await check("an answer the buy won't act on also falls back, having sent nothing", async () => {
  const noApproval = { "/check_approval": { json: { approval: approvalTx, cancel: null } } };
  const cases: [BuyRequest, Record<string, Answer>, RegExp][] = [
    [SMALL, { ...noApproval, "/quote": { json: classicQuote({ routing: "BRIDGE" }) } }, /routing BRIDGE/],
    [SMALL, { ...noApproval, "/quote": { json: dutchQuote({ routing: "DUTCH_V2" }) } }, /routing DUTCH_V2/],
    // a caller that can't hold an open order never takes one
    [{ ...LARGE, allowOrders: false }, { ...noApproval, "/quote": { json: dutchQuote() } }, /routing DUTCH_V3/],
    [SMALL, { ...noApproval, "/quote": { json: classicQuote() }, "/swap": { json: swapAnswer({ to: OTHER }) } }, /the swap is not/],
    [SMALL, { ...noApproval, "/quote": { json: classicQuote() }, "/swap": { json: swapAnswer({ value: "0x1" }) } }, /would send ETH/],
    [SMALL, { ...noApproval, "/quote": { json: classicQuote({ permitTransaction: approvalTx }) } }, /on-chain permit/],
    [SMALL, { "/check_approval": { json: { approval: { ...approvalTx, to: OTHER }, cancel: null } } }, /the approval is not/],
    [SMALL, { "/check_approval": { json: { approval: approvalTx, cancel: approvalTx } } }, /reset the allowance/],
    [SMALL, { ...noApproval, "/quote": { json: classicQuote({ quote: { ...classicQuote().quote, output: { ...classicQuote().quote.output, recipient: OTHER } } }) } }, /does not go to the agent/],
    [SMALL, { ...noApproval, "/quote": { json: classicQuote({ quote: { ...classicQuote().quote, output: { ...classicQuote().quote.output, minimumAmount: "1" } } }) } }, /below our slippage/],
  ];
  const withSpender = (spender: string) => {
    const q = dutchQuote();
    return { ...q, permitData: { ...q.permitData, values: { ...q.permitData.values, spender } } };
  };
  cases.push([LARGE, { ...noApproval, "/quote": { json: withSpender(OTHER) } }, /not for the UniswapX reactor/]);
  const toOther = dutchQuote();
  toOther.permitData.values.witness.baseOutputs = [{ ...toOther.permitData.values.witness.baseOutputs[0], recipient: OTHER }];
  cases.push([LARGE, { ...noApproval, "/quote": { json: toOther } }, /does not all go to the agent/]);
  for (const [request, answers, reason] of cases) {
    const a = api(answers);
    const c = chain();
    const r = await buy(request, "test-key", a, c);
    assert.equal(r.err, undefined, String(reason));
    assert.equal(r.fill?.route, "direct v3");
    assert.match(r.fill?.fallbackReason ?? "", reason);
    assert.equal(c.sent.length, 0, String(reason));
    assert.ok(!a.paths().includes("/order"), String(reason));
  }
});

await check("an order handed over and not filled in time: no fallback, and the error names the order", async () => {
  const a = api({
    "/check_approval": { json: { approval: null, cancel: null } },
    "/quote": { json: dutchQuote() },
    "/order": { status: 201, json: { orderId: ORDER_ID, orderStatus: "open" } },
    "/orders": { json: orders("open") },
  });
  const c = chain();
  const r = await buy(LARGE, "test-key", a, c);
  assert.equal(r.fill, undefined);
  assert.equal(r.directCalls(), 0);
  assert.match(String(r.err), /has not filled yet/);
  assert.deepEqual(failureMarks(r.err), { orderHash: ORDER_ID, route: "uniswap-api UniswapX", requestId: "dutch-request" });
  assert.ok(c.elapsed() >= 120_000 && c.elapsed() < 125_000, `polled for ${c.elapsed()} ms`);
});

await check("an order /order didn't answer may be live: no fallback, the order is named", async () => {
  const a = api({ "/check_approval": { json: { approval: null, cancel: null } }, "/quote": { json: dutchQuote() }, "/order": "no answer", "/orders": { json: orders("open") } });
  const r = await buy(LARGE, "test-key", a, chain());
  assert.equal(r.directCalls(), 0);
  assert.equal(failureMarks(r.err).orderHash, ORDER_ID);
  assert.ok(!a.paths().includes("/orders"));
});

await check("an order /order refused, or one that ended unfilled: no fallback, and nothing is held", async () => {
  for (const answers of [
    { "/order": { status: 400, json: { errorCode: "RequestValidationError" } } },
    { "/order": { status: 201, json: { orderId: ORDER_ID, orderStatus: "open" } }, "/orders": { json: orders("expired") } },
  ] as Record<string, Answer>[]) {
    const a = api({ "/check_approval": { json: { approval: null, cancel: null } }, "/quote": { json: dutchQuote() }, ...answers });
    const r = await buy(LARGE, "test-key", a, chain());
    assert.equal(r.directCalls(), 0);
    assert.ok(r.err);
    assert.deepEqual(failureMarks(r.err), { route: "uniswap-api UniswapX", requestId: "dutch-request" });
  }
});

await check("a swap sent whose receipt can't be read, or that reverted: no fallback, the error carries its hash", async () => {
  for (const receipt of [new Error("Timed out while waiting for transaction"), { status: "reverted" as const, logs: [] }]) {
    const a = api({ "/check_approval": { json: { approval: null, cancel: null } }, "/quote": { json: classicQuote() }, "/swap": { json: swapAnswer() } });
    const c = chain({ [hashOf(1)]: receipt });
    const r = await buy(SMALL, "test-key", a, c);
    assert.equal(r.directCalls(), 0);
    assert.deepEqual(failureMarks(r.err), { txHash: hashOf(1), route: "uniswap-api CLASSIC", requestId: "a9395818b2c0a3c3c103326d08594ebf" });
  }
});

await check("an approval sent, then the swap's send fails: no fallback, and no hash — nothing of the buy moved", async () => {
  const a = api({ "/check_approval": { json: { approval: approvalTx, cancel: null } }, "/quote": { json: classicQuote() }, "/swap": { json: swapAnswer() } });
  const c = chain();
  const send = c.wallet.sendTransaction;
  c.wallet.sendTransaction = async (tx) => {
    if (tx.to === TRADING_API.universalRouter) throw new Error("nonce too low");
    return send(tx);
  };
  const r = await buy(SMALL, "test-key", a, c);
  assert.equal(r.directCalls(), 0);
  assert.match(String(r.err), /nonce too low/);
  assert.deepEqual(failureMarks(r.err), { route: "uniswap-api CLASSIC", requestId: "a9395818b2c0a3c3c103326d08594ebf" });
});

await check("a direct buy that fails after a fallback keeps the reason on its error", async () => {
  const a = api({ "/check_approval": "no answer" });
  const err = await buyWethWithUsdc({
    request: SMALL,
    apiKey: "test-key",
    api: { fetch: a.fetch, wallet: chain().wallet, sleep: async () => {}, now: () => 0 },
    direct: async () => {
      throw Object.assign(new Error("the swap reverted on Base"), { txHash: DIRECT_TX });
    },
  }).catch((e: unknown) => e);
  assert.deepEqual(failureMarks(err), { txHash: DIRECT_TX, route: "direct v3", fallbackReason: "/check_approval did not answer" });
});

console.log(`uniswap-api-selftest: ${passed} checks passed`);
