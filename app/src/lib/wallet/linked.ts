// A user's linked wallet: users.ain_address only when it is a real 0x address. Demo accounts
// carry "demo:<slug>" there and AIN logins their own format; neither can own an ENS name.
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

export function linkedWallet(user: { ainAddress: string | null | undefined }): `0x${string}` | null {
  const a = user.ainAddress?.trim().toLowerCase();
  return a && EVM_ADDRESS.test(a) ? (a as `0x${string}`) : null;
}
