import { db } from "@/lib/db";
import type { T } from "@/i18n/translate";
import { databases, dbProperties, dbRows, dbViews } from "@/lib/db/schema";
import type { Database, DbProperty, DbRow, DbView } from "@/lib/db/schema";

function rid() {
  return crypto.randomUUID();
}

export interface DatabaseSnapshot {
  database: Database;
  properties: DbProperty[];
  rows: DbRow[];
  views: DbView[];
}

/**
 * Creates a project-tracker-shaped database: Name(title), Status(select),
 * Assignee(person), Due(date) + a Table view and a Board view grouped by
 * Status. This is the "can you run a project" default (parity ask).
 */
/** Default names are stored in the creator's language, as Notion does —
 *  pass the request's `t` (getT(user.language)); Korean when absent. */
export async function provisionDatabase(
  workspaceId: string,
  userId: string,
  title = "",
  shape: "tracker" | "minimal" = "tracker",
  t: T = (k) => k
): Promise<DatabaseSnapshot> {
  if (!title && shape === "tracker") title = t("Tasks");
  // A database created as a page of its own starts bare, the way Notion's does:
  // one Name column, one Table view, no rows. The tracker shape below is for the
  // inline /database command, whose whole promise is "table + board".
  if (shape === "minimal") return provisionMinimal(workspaceId, userId, title, t);
  const [database] = await db
    .insert(databases)
    .values({ workspaceId, title, createdBy: userId })
    .returning();

  const statusOptions = [
    { id: rid(), name: t("To-do"), color: "gray" },
    { id: rid(), name: t("In progress"), color: "blue" },
    { id: rid(), name: t("Done"), color: "green" },
  ];

  const propDefs: {
    name: string;
    type: DbProperty["type"];
    config: DbProperty["config"];
  }[] = [
    { name: t("Name"), type: "title", config: {} },
    { name: t("Status"), type: "status", config: { options: statusOptions } },
    { name: t("Assignee"), type: "person", config: {} },
    { name: t("Due"), type: "date", config: {} },
  ];

  const properties = await db
    .insert(dbProperties)
    .values(
      propDefs.map((p, i) => ({
        databaseId: database.id,
        name: p.name,
        type: p.type,
        config: p.config,
        position: i + 1,
      }))
    )
    .returning();

  const titleProp = properties.find((p) => p.type === "title")!;
  const statusProp = properties.find((p) => p.type === "status")!;

  const rows = await db
    .insert(dbRows)
    .values(
      ["Design the schema", "Build the API", "Ship it"].map((name, i) => ({
        databaseId: database.id,
        values: {
          [titleProp.id]: name,
          [statusProp.id]: statusOptions[Math.min(i, 2)].id,
        },
        position: i + 1,
        createdBy: userId,
        updatedBy: userId,
      }))
    )
    .returning();

  const views = await db
    .insert(dbViews)
    .values([
      { databaseId: database.id, name: t("Table"), type: "table" as const, config: {}, position: 1 },
      {
        databaseId: database.id,
        name: t("Board"),
        type: "board" as const,
        config: { groupByPropertyId: statusProp.id },
        position: 2,
      },
    ])
    .returning();

  return { database, properties, rows, views };
}


/** A bare database: title property only, single table view, no rows. */
async function provisionMinimal(
  workspaceId: string,
  userId: string,
  title: string,
  t: T
): Promise<DatabaseSnapshot> {
  const [database] = await db
    .insert(databases)
    .values({ workspaceId, title, createdBy: userId })
    .returning();

  const properties = await db
    .insert(dbProperties)
    .values([{ databaseId: database.id, name: t("Name"), type: "title" as const, config: {}, position: 1 }])
    .returning();

  const views = await db
    .insert(dbViews)
    .values([
      { databaseId: database.id, name: t("Table"), type: "table" as const, config: {}, position: 1 },
    ])
    .returning();

  return { database, properties, rows: [], views };
}
