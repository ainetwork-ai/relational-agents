import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar/sidebar";
import { SearchModal } from "@/components/search-modal";
import { PagePeek } from "@/components/page/page-peek";
import { MobileNavToggle } from "@/components/sidebar/mobile-nav-toggle";
import { ToastHost } from "@/components/toast-host";
import { LocaleProvider } from "@/i18n/provider";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) redirect("/login");

  const locale = await getLocale(user.language);
  const workspaceId = await getDefaultWorkspaceId(user.id);
  const [workspace] = workspaceId
    ? await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    : [];

  return (
    <LocaleProvider locale={locale}>
    <div className="flex h-screen overflow-hidden bg-white dark:bg-[#191919]">
      <Sidebar
        workspace={
          workspace
            ? {
                id: workspace.id,
                name: workspace.name,
                iconText: workspace.iconText,
                description: workspace.description,
              }
            : null
        }
        workspaceName={workspace?.name ?? "Workspace"}
        displayName={user.displayName}
      />
      <MobileNavToggle />
      {/* overscroll-contain: reaching the top/bottom of the page must not hand the
          scroll on to the root (see globals.css) */}
      <main aria-label="Page content" className="flex-1 overflow-y-auto overscroll-contain">
        {children}
        <ToastHost />
      </main>
      <SearchModal />
      {/* center peek — a page opened over the current one (sidebar + on a page) */}
      <PagePeek />
    </div>
    </LocaleProvider>
  );
}
