/**
 * The English family demo (DEMO_CONTENT_LANG=en) — names, drive names, the
 * family workspace and the pocket-money ledger as its data names them. The
 * Korean demo's are in ./family-demo and ./scripts; pick one through
 * ./demo-lang, never by importing either directly.
 *
 * The files these paths point at are made by the generators in
 * ~/.ainmem-demo-en/source/tools (gen_en.py, media_en.py).
 */

/** Family members as the demo's data names them, with their English display names. */
export const FAMILY = {
  grandma: { name: "Grandma", en: "Grandma" },
  mom: { name: "Mom", en: "Mom" },
  dad: { name: "Dad", en: "Dad" },
  seoyeon: { name: "Seoyeon", en: "Seoyeon" },
  doyun: { name: "Doyun", en: "Doyun" },
  everyone: { name: "Everyone", en: "Everyone" },
} as const;

/** The family workspace's teamspace (and family chat room). */
export const FAMILY_WORKSPACE_NAME = "Our Family";

/** The pocket-money ledger each person keeps in their own aindrive. Six
 *  columns — src/lib/gift.ts reads the balance (5th) and receipt (6th). */
export const LEDGER = {
  out: "wallet/pocket_money_ledger.csv",
  in: "wallet/received_pocket_money.csv",
  head: "Date,Description,With,Amount (KRW),Balance (KRW),Receipt",
  /** the "Description" column of a gift row: `Pocket money · <title>` */
  entry: (title: string) => `Pocket money · ${title}`,
} as const;

/** family-demo-accounts.mts: who the demo family is — the name they go by in
 *  the workspace, and their aindrive drive's name. */
export const FAMILY_DEMO_ACCOUNTS = [
  { key: "grandma", name: "Grandma", drive: "Grandma's Kitchen & Album" },
  { key: "mom", name: "Mom", drive: "Mom's Household" },
  { key: "dad", name: "Dad", drive: "Dad's Records" },
  { key: "seoyeon", name: "Seoyeon", drive: "Seoyeon's Phone" },
  // Mom's father — not in the family workspace at first; the demo invites him (Family folders → Invite)
  { key: "grandpa", name: "Grandpa", drive: "Grandpa's Phone" },
] as const;
