import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { blocks, pages, pageShares } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReadOnlyBlocks } from "@/components/read-only-blocks";
import { SharedPageEditor } from "@/components/share/shared-page-editor";
import type { Page } from "@/lib/db/schema";
import { PageIcon } from "@/components/page-icon";
import { SharePasswordForm } from "@/components/share/share-password-form";
import { ShareDuplicateButton } from "@/components/share/share-duplicate-button";

export const dynamic = "force-dynamic";

type Permission = "view" | "comment" | "edit" | "full";

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [share] = await db
    .select()
    .from(pageShares)
    .where(eq(pageShares.token, token))
    .limit(1);
  if (!share) notFound();

  // expired links are dead links
  if (linkExpired(share.expiresAt)) notFound();

  // password gate: the unlock cookie must carry the current hash
  if (share.passwordHash) {
    const jar = await cookies();
    if (jar.get(`share_pw_${token}`)?.value !== share.passwordHash) {
      return <SharePasswordForm token={token} />;
    }
  }

  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, share.pageId))
    .limit(1);
  if (!page || page.isArchived) notFound();

  const blockRows = await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, page.id))
    .orderBy(blocks.position);

  const permission = (share.permission ?? "view") as Permission;

  // For edit, comment, or full: render the interactive client component
  if (permission !== "view") {
    return (
      <main className="min-h-screen bg-white dark:bg-[#191919]">
        {share.allowDuplicate && <ShareDuplicateButton token={token} />}
        <SharedPageEditor
          page={page as Page}
          blocks={blockRows}
          permission={permission}
          shareToken={token}
        />
      </main>
    );
  }

  // View-only: static read-only render (original behavior)
  return (
    <main className="min-h-screen bg-white pb-32 dark:bg-[#191919]">
      {share.allowDuplicate && <ShareDuplicateButton token={token} />}
      {page.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.coverUrl} alt="" className="h-48 w-full object-cover" />
      )}
      <div className="mx-auto max-w-[708px] px-6">
        <div className={page.coverUrl ? "-mt-8" : "pt-16"}>
          {page.icon && <span className="text-6xl leading-none"><PageIcon icon={page.icon} /></span>}
        </div>
        <h1 className="mt-2 text-4xl font-bold text-neutral-900 dark:text-neutral-100">
          {page.title || "Untitled"}
        </h1>
        <div className="mt-4">
          <ReadOnlyBlocks blocks={blockRows} />
        </div>
        <p className="mt-16 border-t border-neutral-100 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
          Shared read-only · Built with Notion clone
        </p>
      </div>
    </main>
  );
}

/** Server-side expiry check (kept outside the component for lint purity). */
function linkExpired(expiresAt: Date | null): boolean {
  return !!expiresAt && expiresAt.getTime() < Date.now();
}
