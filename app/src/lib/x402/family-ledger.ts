import "server-only";
import { ledgerDriveOf, settle, signPayment, userByWallet, walletOf } from "@/lib/gift";
import type { X402Provider } from "./provider";

/**
 * The family-ledger provider: a wallet key this server keeps for each person,
 * settlement written as rows into the payer's and the recipient's own
 * aindrive (the out/in ledger CSVs, LEDGER in i18n/content/family-demo) over MCP, as each of them.
 * The signature is a real EIP-3009 authorization; no chain is touched.
 */
export const familyLedger: X402Provider = {
  id: "family-ledger",

  async ready(userId) {
    return !!(await ledgerDriveOf(userId));
  },

  async payToOf(userId) {
    return (await walletOf(userId)).address;
  },

  async sign(payer, req, resourceUrl) {
    const wallet = await walletOf(payer.userId);
    return signPayment(wallet.key, req, resourceUrl);
  },

  async payerOf(payment) {
    const u = await userByWallet(payment.payload.authorization.from);
    return u ? { userId: u.id, name: u.displayName } : null;
  },

  async settle(spec, payment, payer) {
    const driveId = await ledgerDriveOf(payer.userId);
    if (!driveId) return { ok: false, error: "the payer has no aindrive device for the ledger" };
    const r = await settle(spec, payment, { ...payer, driveId }, spec.file.driveId);
    return "error" in r ? { ok: false, error: r.error } : { ok: true, receipt: r.receipt };
  },
};
