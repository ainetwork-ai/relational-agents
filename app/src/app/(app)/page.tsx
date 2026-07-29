import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { EmptyHome } from "@/components/empty-home";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // No workspace explicitly chosen this session → land on Home, where the
  // workspace cards live. Deep links (/p/…) are untouched; only the root
  // route routes through the picker. Once a card is clicked (or the switcher
  // used), activeWorkspaceId is pinned and the root goes straight to content.
  if (!session.activeWorkspaceId) redirect("/home");

  const workspaceId = await getDefaultWorkspaceId(session.userId);
  if (workspaceId) {
    const [first] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, workspaceId),
          eq(pages.isArchived, false),
          isNull(pages.parentPageId)
        )
      )
      .orderBy(pages.position)
      .limit(1);
    if (first) redirect(`/p/${first.id}`);
  }

  return <EmptyHome />;
}
