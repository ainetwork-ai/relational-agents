import "server-only";
import { aindriveX402, aindriveX402Available } from "./aindrive";
import { familyLedger } from "./family-ledger";
import { settlementMode, type SettlementId, type X402Provider } from "./provider";

export type { PayerRef, SettleResult, SettlementId, X402Provider } from "./provider";
export { settlementMode } from "./provider";

const PROVIDERS: Record<SettlementId, X402Provider> = { "family-ledger": familyLedger, aindrive: aindriveX402 };

export function providerById(id: string | undefined): X402Provider | null {
  return id && id in PROVIDERS ? PROVIDERS[id as SettlementId] : null;
}

/**
 * The provider this person pays (or is paid) with:
 *   GIFT_SETTLEMENT=aindrive  aindrive, or nothing — never a silent fallback
 *   GIFT_SETTLEMENT=ledger    the family ledger
 *   auto (default)            aindrive when its x402 tools are there for this
 *                             account, else the family ledger
 */
export async function providerFor(userId: string): Promise<X402Provider> {
  const mode = settlementMode();
  if (mode === "ledger") return familyLedger;
  const drive = await aindriveX402Available(userId);
  if (mode === "aindrive") {
    if (!drive) throw new Error("aindrive has no x402 tools for this account yet (GIFT_SETTLEMENT=aindrive)");
    return aindriveX402;
  }
  return drive ? aindriveX402 : familyLedger;
}
