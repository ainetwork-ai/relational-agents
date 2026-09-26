import { routerProvider } from "./router.js";

const providers = { router: routerProvider };

/** `SWAP_PROVIDER` picks the implementation; every one returns { quote, execute }. */
export function swapProvider(name = process.env.SWAP_PROVIDER ?? "router", chain) {
  const make = providers[name];
  if (!make) throw new Error(`unknown swap provider "${name}" — known: ${Object.keys(providers).join(", ")}`);
  return make(chain);
}
