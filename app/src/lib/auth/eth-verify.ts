/**
 * MetaMask `personal_sign` (EIP-191) verification without any new dependency:
 * ain-js bundles ain-util, whose keccak/secp256k1-recovery primitives are the
 * same ones Ethereum uses (AIN addresses are Ethereum-format). Only the
 * message prefix differs — Ethereum's "\x19Ethereum Signed Message:\n<len>"
 * instead of AIN's — so we hash with the Ethereum prefix and recover.
 */

/** The slice of ain-util (exposed as `Ain.utils`) this module relies on.
 *  ain-util is not a direct dependency, so its types aren't resolvable —
 *  declared locally instead. */
interface AinUtil {
  keccak(input: unknown, bits?: number): Buffer;
  toBuffer(v: unknown): Buffer;
  ecRecoverPub(
    msgHash: Buffer,
    r: Buffer,
    s: Buffer,
    v: number,
    chainId?: number
  ): Buffer;
  pubToAddress(publicKey: Buffer, isSEC1?: boolean): Buffer;
  bufferToHex(buf: Buffer): string;
  areSameAddresses(a: string, b: string): boolean;
}

/** keccak256 of the EIP-191 personal_sign envelope for `message`. */
export function personalSignHash(utils: AinUtil, message: string): Buffer {
  const msgBytes = Buffer.from(message, "utf8");
  const prefix = Buffer.from(
    `\x19Ethereum Signed Message:\n${msgBytes.length}`,
    "utf8"
  );
  return utils.keccak(Buffer.concat([prefix, msgBytes]));
}

export function verifyEthSignature(
  message: string,
  signature: string,
  address: string
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ain = require("@ainblockchain/ain-js").default;
    const utils = Ain.utils as AinUtil;

    const sig = utils.toBuffer(signature);
    if (sig.length !== 65) return false;
    const r = Buffer.from(sig.subarray(0, 32));
    const s = Buffer.from(sig.subarray(32, 64));
    let v = sig[64];
    if (v < 27) v += 27; // MetaMask may emit recovery id 0/1 or 27/28

    const hash = personalSignHash(utils, message);
    const pub = utils.ecRecoverPub(hash, r, s, v);
    const recovered = utils.bufferToHex(utils.pubToAddress(Buffer.from(pub.subarray(1))));
    return utils.areSameAddresses(recovered, address);
  } catch {
    return false;
  }
}
