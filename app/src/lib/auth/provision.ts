import { db } from "@/lib/db";
import { workspaces, workspaceMembers, pages, blocks, type BlockType } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { firstGlyphs } from "@/lib/glyph";

// The first page every new account lands on. It has one job: explain what
// makes this workspace different from a notes app — the agent is born from a
// signed agreement between two people, not installed by one. Ordinary editor
// tips come second, because they are the part nobody needs explained twice.
const GETTING_STARTED: { type: BlockType; text: string; checked?: boolean; icon?: string }[] = [
  { type: "heading1", text: "You see me, therefore I am" },
  {
    type: "paragraph",
    text: "This is a workspace for the people in your life. Pages, databases and the editor work the way you expect. What is different is who else is writing: a relational agent that keeps the record of a relationship, and that cannot exist until both people say yes.",
  },
  { type: "divider", text: "" },

  { type: "heading2", text: "Start a relationship" },
  {
    type: "paragraph",
    text: "An agent is not something you install. It is born from an agreement, and it only ever remembers the one relationship it was born into.",
  },
  {
    type: "numbered_list",
    text: "Open the Chats tab in the sidebar and press + beside Relationships to invite someone.",
  },
  { type: "numbered_list", text: "Both of you sign the relationship contract in the banner at the top of the chat." },
  {
    type: "numbered_list",
    text: "The agent is born. From that moment it reads the conversation and keeps a shared record of it — never anything said before the signatures.",
  },
  {
    type: "callout",
    icon: "🔒",
    text: "Ending it mirrors starting it. Either of you can ask to dissolve the relationship, and it closes only once you have both signed — the same two signatures that created the agent. The record of what happened stays.",
  },

  { type: "heading2", text: "Talking to the agent" },
  {
    type: "bulleted_list",
    text: "Mention @agent in the chat to ask it something. That question and its answer are visible to everyone in the room.",
  },
  {
    type: "bulleted_list",
    text: "Press the lock beside the message box to ask quietly instead — only you and the agent see it, and it never reaches the shared record.",
  },
  {
    type: "bulleted_list",
    text: "When something you said becomes part of the record, an 'Added to your record' marker appears under the message and links straight to the entry. The agent never has to announce itself.",
  },

  { type: "heading2", text: "Make it yours" },
  { type: "todo", text: "Set your name and photo — the chip at the bottom left of the sidebar", checked: false },
  { type: "todo", text: "Hover the cover on your home screen and press 'Change cover'", checked: false },
  { type: "todo", text: "Create a page from the sidebar and type '/' for commands", checked: false },
  { type: "todo", text: "Try markdown shortcuts: '# ' for a heading, '- ' for a list, '[] ' for a checkbox", checked: false },
  { type: "todo", text: "Start your first relationship above", checked: false },

  {
    type: "quote",
    text: "One agent per person leaks what it knows. An agent per relationship cannot — it only ever knew the two of you.",
  },
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
      content: {
        text: b.text,
        ...(b.checked !== undefined ? { checked: b.checked } : {}),
        ...(b.icon ? { icon: b.icon } : {}),
      },
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
      .values({ name: base, iconText: firstGlyphs(displayName, 2).toUpperCase(), createdBy: userId })
      .returning();
  } catch {
    [workspace] = await db
      .insert(workspaces)
      .values({
        name: `${base} ${userId.slice(0, 6)}`,
        iconText: firstGlyphs(displayName, 2).toUpperCase(),
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
