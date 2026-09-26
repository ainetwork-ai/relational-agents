import { recoverTypedDataAddress } from "viem";
import { mandateTypedData } from "./typedData.js";

/** Who signed this mandate. Membership is the caller's question; this only answers "who". */
export async function recoverMandateSigner(m, chainId, signature) {
  return recoverTypedDataAddress({ ...mandateTypedData(m, chainId), signature });
}
