import { base } from "./base.js";

const chains = { base };

/** The one place a chain name becomes addresses. Throws on an unknown name. */
export function chainByName(name = process.env.CHAIN ?? "base") {
  const chain = chains[name];
  if (!chain) throw new Error(`unknown chain "${name}" — known: ${Object.keys(chains).join(", ")}`);
  return chain;
}
