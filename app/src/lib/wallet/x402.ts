/** Browser wallet adapter for AIN-UI's official x402 client. */
import type { TypedDataDefinition } from "viem";
import { signX402Payment } from "ain-ui/x402";
import { connectWallet, signTypedDataWithWallet } from "./sign";

export async function payX402WithWallet(paymentRequired: string) {
  const from = await connectWallet({ selectAccount: true });
  return signX402Payment(paymentRequired, {
    address: from,
    signTypedData: async (data) => {
      const { signature } = await signTypedDataWithWallet(data as TypedDataDefinition, { address: from });
      return signature;
    },
  });
}
