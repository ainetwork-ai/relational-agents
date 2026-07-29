import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

/**
 * MetaMask-style personal_sign for e2e, with zero new dependencies: ain-js
 * (already a dep) bundles ain-util (keccak, address derivation) and
 * secp256k1 v3 (recoverable ECDSA). AIN accounts are Ethereum-format, so
 * the same key material works for both flows.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AinJs = require("@ainblockchain/ain-js").default;
const util = AinJs.utils;
// secp256k1 is not a direct app dependency — resolve it through ain-js.
const secp = createRequire(require.resolve("@ainblockchain/ain-js"))("secp256k1");

export interface EthTestAccount {
  privateKey: Buffer;
  address: string;
}

export function makeEthAccount(): EthTestAccount {
  const privateKey = randomBytes(32);
  const address = util.toChecksumAddress(
    util.bufferToHex(util.privateToAddress(privateKey))
  );
  return { privateKey, address };
}

/** Signs `message` exactly like MetaMask's personal_sign (EIP-191). */
export function personalSign(message: string, privateKey: Buffer): string {
  const msgBytes = Buffer.from(message, "utf8");
  const prefixed = Buffer.concat([
    Buffer.from(`\x19Ethereum Signed Message:\n${msgBytes.length}`, "utf8"),
    msgBytes,
  ]);
  const hash = util.keccak(prefixed);
  const { signature, recovery } = secp.sign(hash, privateKey);
  return (
    "0x" +
    Buffer.concat([signature, Buffer.from([recovery + 27])]).toString("hex")
  );
}
