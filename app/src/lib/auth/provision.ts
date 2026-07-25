import { db } from "@/lib/db";
import { workspaces, workspaceMembers, pages, blocks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const GETTING_STARTED = [
  { type: "heading1" as const, text: "Welcome" },
  { type: "paragraph" as const, text: "Type '/' for commands, or just start writing." },
  { type: "todo" as const, text: "Create your first page from the sidebar", checked: false },
  { type: "todo" as const, text: "Try markdown shortcuts like '# ' and '- '", checked: false },
];

async function seedGettingStarted(workspaceId: string, userId: string) {
  const [page] = await db
    .insert(pages)
    .values({ workspaceId, title: "Getting Started", icon: "👋", position: 1, createdBy: userId })
    .returning();
  await db.insert(blocks).values(
    GETTING_STARTED.map((b, i) => ({
      pageId: page.id,
      type: b.type,
      content: { text: b.text, ...(b.checked !== undefined ? { checked: b.checked } : {}) },
      position: i + 1,
    }))
  );
}

/**
 * Equivalent to slack-a2a's channel auto-join: make sure the user has a
 * workspace to land in. First login creates a personal workspace with a
 * seeded "Getting Started" page.
 */
export async function ensureWorkspace(userId: string, displayName: string) {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  if (membership) {
 // self-heal: if the workspace was emptied, re-seed a Getting Started page
 // so demo/login always lands somewhere (an empty workspace is a dead end).
    const [anyPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.workspaceId, membership.workspaceId), eq(pages.isArchived, false)))
      .limit(1);
    if (!anyPage) await seedGettingStarted(membership.workspaceId, userId);
    return membership.workspaceId;
  }

 // workspaces.name is globally unique (schema copied from slack-a2a), so
 // suffix with a short id to avoid collisions between same-named users.
  const base = `${displayName}'s Workspace`;
  let workspace;
  try {
    [workspace] = await db
      .insert(workspaces)
      .values({ name: base, iconText: displayName.slice(0, 2).toUpperCase(), createdBy: userId })
      .returning();
  } catch {
    [workspace] = await db
      .insert(workspaces)
      .values({
        name: `${base} ${userId.slice(0, 6)}`,
        iconText: displayName.slice(0, 2).toUpperCase(),
        createdBy: userId,
      })
      .returning();
  }

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId, role: "owner" })
    .onConflictDoNothing();

  await seedGettingStarted(workspace.id, userId);
  return workspace.id;
}
