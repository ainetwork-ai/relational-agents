import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CallView } from "@/components/call/call-view";

export const dynamic = "force-dynamic";

/** Video-call view for a DM room. The (app) layout supplies the sidebar;
 * everything call-specific is client-side in CallView. */
export default async function CallPage(ctx: { params: Promise<{ roomId: string }> }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const { roomId } = await ctx.params;
  return <CallView roomId={roomId} />;
}
