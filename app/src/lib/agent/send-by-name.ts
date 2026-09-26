// app/src/lib/agent/send-by-name.ts
// "send Minjun 20 USDC": the ens-family core decides; this turns its answer into a reply
// and, when ready, a signed link to approve the transfer in the asker's own wallet.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { makeT } from "@/i18n/translate";
import { familyChain, sendSecret } from "@/lib/ens-chain";
import { ensureNicknamesTable, loadNicknames } from "@/lib/ens-nicknames";
import { prepareSend } from "@/lib/ens-family/prepare";
import { displayName } from "@/lib/ens-family/family-tree";
import { formatUsdc } from "@/lib/ens-family/send-request";
import { signSendIntent } from "@/lib/ens-family/send-token";
import type { SkillContext, SkillResult } from "./family-skills";

export async function sendByName(ctx: SkillContext): Promise<SkillResult> {
  const t = makeT(ctx.lang);
  const chain = familyChain();
  if (!chain) return { text: t("Family names aren't set up here yet.") };
  const [me] = await db.select({ address: users.ainAddress }).from(users).where(eq(users.id, ctx.askerId));
  if (!me?.address) return { text: t("Sign in with your wallet first, so I know which family name is yours.") };

  const tree = await chain.loadTree();
  const table = await ensureNicknamesTable({ workspaceId: ctx.workspaceId, byUserId: ctx.askerId, tree, t });
  const note = table.pageId
    ? "\n" + t("I made a “Family nicknames” page where you can add the names you call each other → /p/{pageId}", { pageId: table.pageId })
    : "";
  const nicknames = await loadNicknames(ctx.workspaceId);

  const r = await prepareSend({ text: ctx.text, askerAddress: me.address, tree, nicknames }, chain);
  if (r.kind === "ask") return { text: t("Who should get it: {names}?", { names: r.candidates.map(displayName).join(t(" or ")) }) + note };
  if (r.kind === "refuse") {
    const why = {
      "no-request": t("Tell me one amount in USDC, like “send Minjun 20 USDC”."),
      "too-small": t("The smallest amount I can send is 0.01 USDC."),
      "too-large": t("I can send at most 100 USDC at a time."),
      "not-in-family": t("I couldn't find your wallet in the {root} family.", { root: chain.root }),
      nobody: t("I couldn't find that person below you in the family tree."),
      unverified: t("I couldn't confirm {name} on-chain, so I won't prepare this.", { name: r.name ?? "" }),
    }[r.reason];
    return { text: why + note };
  }
  const token = signSendIntent(
    { userId: ctx.askerId, roomId: ctx.roomId ?? "", from: me.address as `0x${string}`, name: r.recipient.name, to: r.to, amountMicro: r.amountMicro.toString() },
    sendSecret()
  );
  return {
    text:
      t("Ready: {amount} USDC to {who} ({name}). Check it and send it from your wallet → /send?t={token}", {
        amount: formatUsdc(r.amountMicro),
        who: displayName(r.recipient),
        name: r.recipient.name,
        token,
      }) + note,
  };
}
