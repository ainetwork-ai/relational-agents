import { getSession } from "@/lib/auth/session";
import { getT } from "@/i18n/server";
import { familyChain, sendSecret } from "@/lib/ens-chain";
import { verifySendIntent, wasSent } from "@/lib/ens-family/send-token";
import { descendants, displayName } from "@/lib/ens-family/family-tree";
import { SendCard } from "@/components/ens/send-card";

export const dynamic = "force-dynamic";

export default async function SendPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const t = await getT();
  const { t: token = "" } = await searchParams;
  const session = await getSession();
  const chain = familyChain();
  const intent = chain ? verifySendIntent(token, sendSecret()) : null;
  const fail = (msg: string) => (
    <main className="mx-auto max-w-sm p-8 text-center text-sm text-neutral-600 dark:text-neutral-300" data-testid="send-error">
      {msg}
    </main>
  );
  if (!chain || !intent || intent.userId !== session.userId) return fail(t("This link has expired or isn't yours. Ask the agent again."));
  const sentTx = wasSent(token);
  const read = await Promise.all([chain.resolveAddress(intent.name), chain.loadTree(), chain.balances(intent.from)]).catch(() => null);
  if (!read) return fail(t("I couldn't reach Sepolia just now. Try again in a moment."));
  const [fresh, tree, bal] = read;
  if (!sentTx && (!fresh || fresh.toLowerCase() !== intent.to.toLowerCase()))
    return fail(t("{name}'s address changed since the agent prepared this, so I stopped. Ask the agent again.", { name: intent.name }));
  const who = descendants(tree).find((d) => d.node.name === intent.name)?.node;
  return (
    <SendCard
      token={token}
      name={intent.name}
      display={who ? displayName(who) : intent.name}
      avatar={who?.avatar ?? null}
      from={intent.from}
      to={intent.to}
      amountMicro={intent.amountMicro}
      usdcMicro={bal.usdcMicro.toString()}
      ethWei={bal.ethWei.toString()}
      sentTx={sentTx}
    />
  );
}
