"use client";

// The account and chain the injected wallet (MetaMask) is on right now, read without a prompt
// (eth_accounts / eth_chainId) and kept current through `accountsChanged` / `chainChanged`.
// Settings › Family names compares it with the account's proven wallet before showing anything
// that acts as that wallet.
import { useCallback, useEffect, useState } from "react";
import { getInjectedProvider, type InjectedEthereumProvider } from "./provider";

export type InjectedAccount =
  | { status: "loading" }
  | { status: "no-provider" }
  | { status: "ready"; account: `0x${string}` | null; chainId: number | null };

const lower = (a: unknown) => (typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a.toLowerCase() as `0x${string}`) : null);
const chainOf = (hex: unknown) => (typeof hex === "string" && Number.isFinite(parseInt(hex, 16)) ? parseInt(hex, 16) : null);

export function useInjectedAccount(): InjectedAccount & { refresh: () => void } {
  const [state, setState] = useState<InjectedAccount>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    const provider: InjectedEthereumProvider | null = getInjectedProvider();
    if (!provider) {
      // after this render, like the answers below
      void Promise.resolve().then(() => alive && setState({ status: "no-provider" }));
      return () => {
        alive = false;
      };
    }
    let account: `0x${string}` | null = null;
    let chainId: number | null = null;
    const publish = () => alive && setState({ status: "ready", account, chainId });
    const onAccounts = (...args: unknown[]) => {
      const list = args[0];
      account = Array.isArray(list) ? lower(list[0]) : null;
      publish();
    };
    const onChain = (...args: unknown[]) => {
      chainId = chainOf(args[0]);
      publish();
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    Promise.all([
      provider.request({ method: "eth_accounts" }).catch(() => []),
      provider.request({ method: "eth_chainId" }).catch(() => null),
    ]).then(([list, hex]) => {
      account = Array.isArray(list) ? lower(list[0]) : null;
      chainId = chainOf(hex);
      publish();
    });
    return () => {
      alive = false;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [tick]);

  return { ...state, refresh };
}
