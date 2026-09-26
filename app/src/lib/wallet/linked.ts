// A user's linked wallet: users.ain_address only when it is a real 0x address. Demo accounts
// carry "demo:<slug>" there and AIN logins their own format; neither can own an ENS name.
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

export function linkedWallet(user: { ainAddress: string | null | undefined }): `0x${string}` | null {
  const a = user.ainAddress?.trim().toLowerCase();
  return a && EVM_ADDRESS.test(a) ? (a as `0x${string}`) : null;
}

/** linkedWallet, but only once a signature proved the account controls it (users.wallet_verified_at).
 *  A 0x-shaped ain_address alone proves nothing: seeded rows carry placeholders such as 0x…0a1d01.
 *  Anything that acts as the user's wallet (Settings › Family names) uses this one. */
export function verifiedWallet(user: {
  ainAddress: string | null | undefined;
  walletVerifiedAt: Date | string | null | undefined;
}): `0x${string}` | null {
  return user.walletVerifiedAt ? linkedWallet(user) : null;
}
