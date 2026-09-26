/** A gift's price as people read it: the sale's own currency when it is sold
 *  through aindrive ("1 USDC"), else pocket money in won via `won`. Pure — the
 *  gift block, its A2UI surface, the chat announcement and the agent share it. */
export function giftPrice(spec: { amountKrw: number; sale?: { price: number; currency: string } }, won: (krw: number) => string): string {
  return spec.sale ? `${spec.sale.price} ${spec.sale.currency}` : won(spec.amountKrw);
}
