import "server-only";
import { decodeFunctionData, encodeFunctionData, parseAbi, parseEventLogs, type Hex, type Log, type TypedDataDomain, type TypedDataParameter } from "viem";
import { isSwapRoute, type SwapRoute } from "./swap-route";

/**
 * The Uniswap Trading API route for the treasury's Base buy (USDC → WETH), and
 * the choice between it and the direct path (invest.ts: QuoterV2 → SwapRouter02).
 *
 * With UNISWAP_API_KEY set, a buy asks the API — /check_approval, /quote — and
 * takes the routing it answers: CLASSIC signs the Permit2 permit, gets the
 * Universal Router transaction from /swap and sends it; DUTCH_V3 and PRIORITY
 * (UniswapX) sign the order, hand it to /order and poll /orders until it fills.
 * On every route the fill is the WETH Transfer to the agent in the receipt.
 *
 * The money rule: until a transaction is sent or an order handed over, nothing
 * can move, so any failure falls back to the direct path in the same run and
 * says why. From then on the run never falls back — a buy that may have gone
 * through must not be made twice — and the error carries the transaction or
 * order hash, so the caller files the attempt as "may have moved".
 */

export const TRADING_API = {
  url: "https://trade-api.gateway.uniswap.org/v1",
  /** pinned: the swap transaction must call exactly this router */
  universalRouterVersion: "2.1.2",
  universalRouter: "0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  /** UniswapX reactors on Base (github.com/Uniswap/UniswapX, deployment addresses) — the only spenders an order permit may name */
  reactors: { DUTCH_V3: "0x000000008a8330B5d1F43A62Bf4C673A49f27ba0", PRIORITY: "0x000000001Ec5656dcdB24D90DFa42742738De729" },
} as const;

const API_TIMEOUT_MS = 10_000;
/** an order still open after this may yet fill: the caller holds the week instead of buying again */
const ORDER_WAIT_MS = 120_000;
const ORDER_POLL_MS = 2_000;
const ALLOWANCE_POLLS = 20;
const ALLOWANCE_POLL_MS = 1_500;
/** the least gas the Universal Router transaction is sent with — an explicit limit, as on the direct path */
const SWAP_GAS = BigInt(400_000);
/** analytics only (the API's X-Agent-Info): every buy runs inside terms verified humans approved */
const AGENT_INFO = JSON.stringify({ decision_origin: "human_mediated", integration_name: "relational-agents treasury" });
/** order states the API calls final that never fill */
const UNFILLED_FINAL = new Set(["expired", "error", "cancelled", "insufficient-funds"]);

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function tradingApiKey(): string | null {
  return process.env.UNISWAP_API_KEY?.trim() || null;
}

export interface BuyRequest {
  chainId: number;
  usdc: `0x${string}`;
  weth: `0x${string}`;
  amountIn: bigint;
  slippageBps: number;
  /**
   * The least WETH any route must guarantee: the v3 pool's quote (QuoterV2) less our slippage. The
   * API's answers are checked against the chain, not only against themselves.
   */
  minOut: bigint;
  /** false: CLASSIC routes only — for a caller whose record has no place for an order that hasn't filled */
  allowOrders: boolean;
}

export interface SwapFill {
  txHash: Hex;
  usdcIn: bigint;
  wethOut: bigint;
  route: SwapRoute;
  /** the /quote call's requestId, whenever the API was asked */
  requestId?: string;
  /** why a buy with the key set took the direct path — fixed text */
  fallbackReason?: string;
}

/** What a failed buy's error names: what went out, and which way it went. */
export interface FailureMarks {
  txHash?: Hex;
  orderHash?: Hex;
  route?: SwapRoute;
  requestId?: string;
  fallbackReason?: string;
}

export interface TypedDataToSign {
  domain: TypedDataDomain;
  types: Record<string, TypedDataParameter[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface SwapTx {
  to: `0x${string}`;
  data: Hex;
  value: bigint;
  gas?: bigint;
}

/** The agent's wallet on Base, as the API route uses it. */
export interface SwapWallet {
  address: `0x${string}`;
  signTypedData(typedData: TypedDataToSign): Promise<Hex>;
  sendTransaction(tx: SwapTx): Promise<Hex>;
  /** throws when the receipt can't be read in time */
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted"; logs: Log[] }>;
  allowance(token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`): Promise<bigint>;
}

export interface TradingApiDeps {
  apiKey: string;
  fetch: typeof fetch;
  wallet: SwapWallet;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** The API answered with an error, or not at all. The message is fixed text: path, status, errorCode. */
export class TradingApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly errorCode?: string
  ) {
    super(status ? `${path} answered ${status}${errorCode ? ` ${errorCode}` : ""}` : `${path} did not answer`);
  }
}

/** An answer this buy won't act on: a routing it doesn't take, a transaction to another contract, … */
class Refused extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const isHash = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

function big(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return BigInt(v);
  return null;
}

/** Attach what went out to a failure, keeping what a deeper layer already named. */
function mark(err: unknown, marks: FailureMarks): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const target = e as Error & Record<string, unknown>;
  for (const [key, value] of Object.entries(marks)) if (value !== undefined && target[key] === undefined) target[key] = value;
  return e;
}

/** What a failed buy's error says went out — read back by the callers that record the attempt. */
export function failureMarks(err: unknown): FailureMarks {
  const e = (isObj(err) || err instanceof Error ? err : {}) as Obj;
  return {
    ...(isHash(e.txHash) ? { txHash: e.txHash } : {}),
    ...(isHash(e.orderHash) ? { orderHash: e.orderHash } : {}),
    ...(isSwapRoute(e.route) ? { route: e.route } : {}),
    ...(typeof e.requestId === "string" ? { requestId: e.requestId } : {}),
    ...(typeof e.fallbackReason === "string" ? { fallbackReason: e.fallbackReason } : {}),
  };
}

/** What a swap delivered to `to`: the WETH Transfers in its own receipt — both routes measure a fill this way. */
export function wethReceived(logs: Log[], weth: string, to: string): bigint {
  return parseEventLogs({ abi: erc20, logs, eventName: "Transfer" })
    .filter((l) => same(l.address, weth) && same(l.args.to, to))
    .reduce((sum, l) => sum + l.args.value, BigInt(0));
}

// ── the API ─────────────────────────────────────────────────────────────────

async function call(deps: TradingApiDeps, path: string, body?: Obj, query?: Record<string, string>): Promise<Obj> {
  let res: Response;
  try {
    res = await deps.fetch(`${TRADING_API.url}${path}${query ? `?${new URLSearchParams(query)}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": deps.apiKey,
        "x-universal-router-version": TRADING_API.universalRouterVersion,
        "x-agent-info": AGENT_INFO,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new TradingApiError(path, 0);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = isObj(json) && typeof json.errorCode === "string" && /^\w{1,64}$/.test(json.errorCode) ? json.errorCode : undefined;
    throw new TradingApiError(path, res.status, code);
  }
  if (!isObj(json)) throw new TradingApiError(path, res.status, "NotJson");
  return json;
}

/** A transaction the API built, only if it is the agent's own call to `to` on this chain, with calldata and no ETH. */
function checkedTx(v: unknown, req: BuyRequest, agent: string, to: string, what: string): SwapTx {
  if (!isObj(v)) throw new Refused(`${what}: no transaction`);
  if (!same(v.to, to) || !same(v.from, agent) || v.chainId !== req.chainId) throw new Refused(`${what} is not the agent's call to the expected contract`);
  if (typeof v.data !== "string" || !/^0x([0-9a-fA-F]{2}){4,}$/.test(v.data)) throw new Refused(`${what} has no calldata`);
  if (big(v.value ?? "0") !== BigInt(0)) throw new Refused(`${what} would send ETH`);
  const gas = big(v.gasLimit);
  return { to: to as `0x${string}`, data: v.data as Hex, value: BigInt(0), ...(gas ? { gas } : {}) };
}

/**
 * /check_approval says whether the agent's USDC needs a Permit2 approval; the approval sent is always
 * our own, for exactly this buy. The API's own transaction approves an unlimited amount, and the pot's
 * USDC is never approved beyond one buy.
 */
function exactApproval(v: unknown, req: BuyRequest, agent: string): SwapTx {
  const tx = checkedTx(v, req, agent, req.usdc, "the approval");
  let approve;
  try {
    approve = decodeFunctionData({ abi: erc20, data: tx.data });
  } catch {
    throw new Refused("the approval is not an ERC-20 approve");
  }
  if (approve.functionName !== "approve" || !same(approve.args[0], TRADING_API.permit2)) throw new Refused("the approval is not to Permit2");
  return { to: req.usdc, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [TRADING_API.permit2, req.amountIn] }), value: BigInt(0) };
}

/** permitData as viem signs it: the domain must be Permit2's on this chain; the primary type is the one no other type names. */
function typedData(raw: unknown, req: BuyRequest): TypedDataToSign {
  if (!isObj(raw) || !isObj(raw.domain) || !isObj(raw.types) || !isObj(raw.values)) throw new Refused("the permit is malformed");
  if (!same(raw.domain.verifyingContract, TRADING_API.permit2) || raw.domain.chainId !== req.chainId) throw new Refused("the permit is not Permit2's on Base");
  const types: Record<string, TypedDataParameter[]> = {};
  for (const [name, fields] of Object.entries(raw.types)) {
    if (name === "EIP712Domain") continue; // viem derives it from the domain
    if (!Array.isArray(fields) || !fields.every((f) => isObj(f) && typeof f.name === "string" && typeof f.type === "string")) throw new Refused("the permit is malformed");
    types[name] = fields as TypedDataParameter[];
  }
  const named = new Set(Object.values(types).flatMap((fields) => fields.map((f) => f.type.replace(/(\[\d*\])+$/, ""))));
  const roots = Object.keys(types).filter((name) => !named.has(name));
  if (roots.length !== 1) throw new Refused("the permit has no single primary type");
  return { domain: raw.domain as TypedDataDomain, types, primaryType: roots[0], message: raw.values };
}

function checkedClassic(answer: Obj, quote: Obj, req: BuyRequest, agent: string): TypedDataToSign | null {
  const { input, output } = quote;
  if (!isObj(input) || !same(input.token, req.usdc) || big(input.amount) !== req.amountIn) throw new Refused("the quote is not for this amount of USDC");
  if (!isObj(output) || !same(output.token, req.weth) || !same(output.recipient, agent)) throw new Refused("the quote's WETH does not go to the agent");
  const out = big(output.amount);
  const min = big(output.minimumAmount);
  // the API applies our slippage; a minimum under it is not the quote we asked for
  if (out === null || min === null || min < (out * BigInt(10_000 - req.slippageBps)) / BigInt(10_000) - BigInt(1)) throw new Refused("the quote's minimum is below our slippage");
  if (min < req.minOut) throw new Refused("the quote's minimum is below the v3 pool's price less our slippage");
  if (answer.permitData == null) return null;
  const permit = typedData(answer.permitData, req);
  const v = permit.message;
  const details = v.details;
  if (permit.primaryType !== "PermitSingle" || !same(v.spender, TRADING_API.universalRouter)) throw new Refused("the permit is not for the Universal Router");
  // we ask for permitAmount EXACT: the Universal Router may pull this buy and nothing more
  if (!isObj(details) || !same(details.token, req.usdc) || big(details.amount) !== req.amountIn) throw new Refused("the permit is not for exactly this buy");
  return permit;
}

function checkedOrder(answer: Obj, req: BuyRequest, agent: string, routing: "DUTCH_V3" | "PRIORITY"): TypedDataToSign {
  const reactor = TRADING_API.reactors[routing];
  const permit = typedData(answer.permitData, req);
  const v = permit.message;
  const witness = isObj(v.witness) ? v.witness : {};
  const info = isObj(witness.info) ? witness.info : {};
  if (permit.primaryType !== "PermitWitnessTransferFrom" || !same(v.spender, reactor) || !same(info.reactor, reactor)) throw new Refused("the order is not for the UniswapX reactor");
  if (!isObj(v.permitted) || !same(v.permitted.token, req.usdc) || big(v.permitted.amount) !== req.amountIn) throw new Refused("the order is not for this amount of USDC");
  if (!same(info.swapper, agent)) throw new Refused("the order is not the agent's");
  // a Dutch order signs baseOutputs, a priority order outputs — every one must be WETH to the agent
  const outputs = routing === "DUTCH_V3" ? witness.baseOutputs : witness.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0 || !outputs.every((o) => isObj(o) && same(o.token, req.weth) && same(o.recipient, agent)))
    throw new Refused("the order's WETH does not all go to the agent");
  // what the order guarantees whatever the auction does: a Dutch output's floor, a priority output's base amount
  const floor = (outputs as Obj[]).reduce((sum, o) => sum + (big(routing === "DUTCH_V3" ? o.minAmount : o.amount) ?? BigInt(0)), BigInt(0));
  if (floor < req.minOut) throw new Refused("the order's floor is below the v3 pool's price less our slippage");
  return permit;
}

interface Progress {
  committed: boolean;
  route?: SwapRoute;
  requestId?: string;
}

async function viaTradingApi(deps: TradingApiDeps, req: BuyRequest, p: Progress): Promise<SwapFill> {
  const { wallet } = deps;
  const agent = wallet.address;
  const amount = req.amountIn.toString();

  // what the buy needs approved, as the API sees it; sent only once the quote checks out
  const check = await call(deps, "/check_approval", {
    walletAddress: agent,
    token: req.usdc,
    amount,
    chainId: req.chainId,
    tokenOut: req.weth,
    tokenOutChainId: req.chainId,
  });
  if (check.cancel != null) throw new Refused("the API asks to reset the allowance first");
  const approval = check.approval == null ? null : exactApproval(check.approval, req, agent);

  const answer = await call(deps, "/quote", {
    type: "EXACT_INPUT",
    amount,
    tokenIn: req.usdc,
    tokenOut: req.weth,
    tokenInChainId: req.chainId,
    tokenOutChainId: req.chainId,
    swapper: agent,
    slippageTolerance: req.slippageBps / 100,
    permitAmount: "EXACT",
    ...(req.allowOrders ? {} : { protocols: ["V2", "V3", "V4"] }),
  });
  if (typeof answer.requestId === "string" && /^[\w-]{1,128}$/.test(answer.requestId)) p.requestId = answer.requestId;
  const { routing, quote } = answer;
  if (!isObj(quote)) throw new Refused("the quote came back without a quote");
  if (answer.permitTransaction != null) throw new Refused("the quote asks for an on-chain permit");
  // documented: absent means an approval is applicable
  const approve = approval && answer.isTokenApprovalApplicable !== false ? approval : null;

  if (routing === "CLASSIC") {
    const permit = checkedClassic(answer, quote, req, agent);
    const signature = permit ? await wallet.signTypedData(permit) : undefined;
    // /swap takes the signature and permitData together, or neither
    const swap = await call(deps, "/swap", signature ? { quote, signature, permitData: answer.permitData } : { quote });
    const tx = checkedTx(swap.swap, req, agent, TRADING_API.universalRouter, "the swap");
    p.route = "uniswap-api CLASSIC";
    p.committed = true; // ── from here on something may move: never fall back
    if (approve) await sendApproval(deps, req, approve);
    const txHash = await wallet.sendTransaction({ ...tx, gas: tx.gas && tx.gas > SWAP_GAS ? tx.gas : SWAP_GAS });
    return { ...(await fillOf(deps, req, txHash)), usdcIn: req.amountIn, route: p.route, requestId: p.requestId };
  }

  if ((routing === "DUTCH_V3" || routing === "PRIORITY") && req.allowOrders) {
    const permit = checkedOrder(answer, req, agent, routing);
    const orderHash = quote.orderId;
    if (!isHash(orderHash)) throw new Refused("the order has no id");
    const signature = await wallet.signTypedData(permit);
    p.route = "uniswap-api UniswapX";
    p.committed = true; // ── from here on something may move: never fall back
    if (approve) await sendApproval(deps, req, approve);
    try {
      await call(deps, "/order", { signature, quote, routing });
    } catch (err) {
      // a refusal is an answer — nothing was taken, so nothing can fill; any other failure may have left it live
      if (err instanceof TradingApiError && err.status >= 400 && err.status < 500) throw err;
      throw mark(err, { orderHash });
    }
    const txHash = await orderFill(deps, orderHash);
    return { ...(await fillOf(deps, req, txHash, orderHash)), usdcIn: req.amountIn, route: p.route, requestId: p.requestId };
  }

  const named = typeof routing === "string" && /^[A-Z_0-9]{1,24}$/.test(routing) ? routing : "unknown";
  throw new Refused(`the API chose routing ${named}, which this buy doesn't take`);
}

/** The Permit2 approval /check_approval built, then — as on the direct path — until THIS client reads the allowance. */
async function sendApproval(deps: TradingApiDeps, req: BuyRequest, tx: SwapTx): Promise<void> {
  const { wallet } = deps;
  const receipt = await wallet.waitForReceipt(await wallet.sendTransaction(tx));
  if (receipt.status !== "success") throw new Error("the Permit2 approval reverted on Base — nothing was swapped");
  for (let i = 0; i < ALLOWANCE_POLLS; i++) {
    if ((await wallet.allowance(req.usdc, wallet.address, TRADING_API.permit2)) >= req.amountIn) return;
    await deps.sleep(ALLOWANCE_POLL_MS);
  }
  throw new Error("the Permit2 allowance is not visible yet — try the buy again in a minute");
}

/** Polls /orders until the order fills (its fill transaction), ends unfilled, or ORDER_WAIT_MS passes. */
async function orderFill(deps: TradingApiDeps, orderHash: Hex): Promise<Hex> {
  const until = deps.now() + ORDER_WAIT_MS;
  for (;;) {
    // a poll that fails is polled again
    const order = await call(deps, "/orders", undefined, { orderId: orderHash })
      .then((r) => (Array.isArray(r.orders) ? r.orders.find((o) => isObj(o) && same(o.orderId, orderHash)) : undefined))
      .catch(() => undefined);
    const status = isObj(order) ? order.orderStatus : undefined;
    if (status === "filled") {
      if (isObj(order) && isHash(order.txHash)) return order.txHash;
      throw mark(new Error("the UniswapX order filled, but the API named no transaction"), { orderHash });
    }
    if (typeof status === "string" && UNFILLED_FINAL.has(status)) throw new Error(`the UniswapX order ended ${status}, unfilled — nothing was spent`);
    if (deps.now() >= until) throw mark(new Error("the UniswapX order has not filled yet — it may still"), { orderHash });
    await deps.sleep(ORDER_POLL_MS);
  }
}

async function fillOf(deps: TradingApiDeps, req: BuyRequest, txHash: Hex, orderHash?: Hex): Promise<{ txHash: Hex; wethOut: bigint }> {
  const receipt = await deps.wallet.waitForReceipt(txHash).catch((err: unknown) => {
    throw mark(err, { txHash, orderHash });
  });
  if (receipt.status !== "success") throw mark(new Error("the swap reverted on Base"), { txHash, orderHash });
  return { txHash, wethOut: wethReceived(receipt.logs, req.weth, deps.wallet.address) };
}

function reasonOf(err: unknown): string {
  if (err instanceof TradingApiError || err instanceof Refused) return err.message;
  const text = err instanceof Error ? err.message : String(err);
  console.error(`uniswap-api: unexpected failure before sending: ${text.split("\n")[0].replace(/https?:\/\/\S+/g, "<url>").slice(0, 160)}`);
  return "the API route failed before sending anything";
}

/**
 * One buy of `request.amountIn` USDC → WETH: through the Trading API when
 * `apiKey` is set, else — or when the API fails before anything is sent — by
 * `direct`. A failure after something was sent is thrown, marked (failureMarks).
 */
export async function buyWethWithUsdc(input: {
  request: BuyRequest;
  apiKey: string | null;
  api: Omit<TradingApiDeps, "apiKey">;
  direct: () => Promise<{ txHash: Hex; wethOut: bigint }>;
}): Promise<SwapFill> {
  const { request, apiKey, api, direct } = input;
  const fellBack: { fallbackReason?: string; requestId?: string } = {};
  if (apiKey) {
    const p: Progress = { committed: false };
    try {
      return await viaTradingApi({ ...api, apiKey }, request, p);
    } catch (err) {
      if (p.committed) throw mark(err, { route: p.route, requestId: p.requestId });
      fellBack.fallbackReason = reasonOf(err);
      if (p.requestId) fellBack.requestId = p.requestId;
      console.warn(`uniswap-api: nothing sent, taking the direct path — ${fellBack.fallbackReason}`);
    }
  }
  const route: SwapRoute = "direct v3";
  try {
    const { txHash, wethOut } = await direct();
    return { txHash, usdcIn: request.amountIn, wethOut, route, ...fellBack };
  } catch (err) {
    throw mark(err, { route, ...fellBack });
  }
}
