import assert from "node:assert/strict";
import { connectWallet } from "../src/lib/wallet/sign";
import { payX402WithWallet } from "../src/lib/wallet/x402";
import { WalletSignatureError, type InjectedEthereumProvider } from "../src/lib/wallet/provider";

// No live wallet or funds: emulate a site still connected to A while the
// user chooses B (then C) in the permission prompt.
const addresses = ["1", "2", "3"].map((n) => `0x${n.repeat(40)}`);
let connected = addresses[0];
let selected = addresses[1];
let permissionError: number | undefined;
let emptyAccounts = false;
const calls: string[] = [];
let signed: { account: string; data: { message: { from: string } } } | undefined;
const provider: InjectedEthereumProvider = {
  isMetaMask: true,
  async request({ method, params }) {
    calls.push(method);
    switch (method) {
      case "wallet_requestPermissions":
        if (permissionError) throw { code: permissionError, message: "Permission denied or unsupported" };
        connected = selected;
        return [{ parentCapability: "eth_accounts", caveats: [] }];
      case "eth_requestAccounts":
        return emptyAccounts ? [] : [connected];
      case "eth_chainId":
        return "0x2105";
      case "eth_signTypedData_v4":
        signed = { account: params![0] as string, data: JSON.parse(params![1] as string) };
        return `0x${"11".repeat(65)}`;
      default:
        throw new Error(`Unexpected wallet method: ${method}`);
    }
  },
};
Object.defineProperty(globalThis, "window", {
  value: Object.assign(new EventTarget(), { ethereum: provider }),
  configurable: true,
});
const quote = btoa(JSON.stringify({
  x402Version: 2,
  accepts: [{
    scheme: "exact", network: "eip155:8453", asset: addresses[0],
    amount: "10000", payTo: addresses[0], maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  }],
}));

async function main() {
  assert.equal(await connectWallet(), addresses[0]);
  assert.deepEqual(calls, ["eth_requestAccounts"], "Ordinary connections keep their existing behavior");

  for (selected of addresses.slice(1)) {
    calls.length = 0;
    const result = await payX402WithWallet(quote);
    const payload = JSON.parse(atob(result.header));
    assert.equal(result.from, selected);
    assert.equal(payload.payload.authorization.from, selected);
    assert.equal(signed?.account, selected);
    assert.equal(signed?.data.message.from, selected);
    assert.deepEqual(calls.slice(0, 2), ["wallet_requestPermissions", "eth_requestAccounts"]);
  }

  for (permissionError of [4001, 4200, -32601]) {
    calls.length = 0;
    await assert.rejects(payX402WithWallet(quote), (err: unknown) =>
      err instanceof WalletSignatureError && err.reason === (permissionError === 4001 ? "rejected" : "failed"));
    assert.deepEqual(calls, ["wallet_requestPermissions"], "Do not sign with an old account after selection fails");
  }
  permissionError = undefined;
  emptyAccounts = true;
  calls.length = 0;
  await assert.rejects(payX402WithWallet(quote), (err: unknown) =>
    err instanceof WalletSignatureError && err.reason === "no-account");
  assert.ok(!calls.includes("eth_signTypedData_v4"));
  console.log("Wallet payment checks passed: account changes, cancellation, unsupported selection, and empty accounts.");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
