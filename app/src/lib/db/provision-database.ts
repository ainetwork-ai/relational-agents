import { db } from "@/lib/db";
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
export async function provisionDatabase(
  workspaceId: string,
  userId: string,
  title = "Tasks",
  shape: "tracker" | "minimal" = "tracker"
): Promise<DatabaseSnapshot> {
  // A database created as a page of its own starts bare, the way Notion's does:
  // one 이름 column, one 표 view, no rows. The tracker shape below is for the
  // inline /database command, whose whole promise is "table + board".
  if (shape === "minimal") return provisionMinimal(workspaceId, userId, title);
  const [database] = await db
    .insert(databases)
    .values({ workspaceId, title, createdBy: userId })
    .returning();

  const statusOptions = [
    { id: rid(), name: "Todo", color: "gray" },
    { id: rid(), name: "In progress", color: "blue" },
    { id: rid(), name: "Done", color: "green" },
  ];

  const propDefs: {
    name: string;
    type: DbProperty["type"];
    config: DbProperty["config"];
  }[] = [
    { name: "Name", type: "title", config: {} },
    { name: "Status", type: "status", config: { options: statusOptions } },
    { name: "Assignee", type: "person", config: {} },
    { name: "Due", type: "date", config: {} },
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
      { databaseId: database.id, name: "Table", type: "table" as const, config: {}, position: 1 },
      {
        databaseId: database.id,
        name: "Board",
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
  title: string
): Promise<DatabaseSnapshot> {
  const [database] = await db
    .insert(databases)
    .values({ workspaceId, title, createdBy: userId })
    .returning();

  const properties = await db
    .insert(dbProperties)
    .values([{ databaseId: database.id, name: "이름", type: "title" as const, config: {}, position: 1 }])
    .returning();

  const views = await db
    .insert(dbViews)
    .values([
      { databaseId: database.id, name: "표", type: "table" as const, config: {}, position: 1 },
    ])
    .returning();

  return { database, properties, rows: [], views };
}
