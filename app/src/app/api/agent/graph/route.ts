import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentRoomStates, blocks, chatRoomMembers, chatRooms, pages } from "@/lib/db/schema";
import { encodeId, nodeExists, readNode } from "@/lib/okf-store";

export const dynamic = "force-dynamic";

export interface GraphNode {
  id: string;
  label: string;
  kind: "room" | "root" | "section" | "page";
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: "owns" | "contains" | "link" | "provenance";
}

const ROOM_LINK_RE = /\/agent-lab\/([0-9a-f-]{36})#msg-/g;

/** GET /api/agent/graph → { nodes, edges } — Obsidian-style graph.
 * Nodes: my rooms + their relationship-doc trees (OKF files are canonical; legacy Postgres docs supported).
 * Edges: room→root (owns), root→section (contains), link_to_page (link), source deep-link→room (provenance). */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const mine = await db.select().from(chatRooms).where(eq(chatRooms.createdBy, auth.user.id));
  const memberRows = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.userId, auth.user.id));
  const memberIds = memberRows.map((m) => m.roomId).filter((id) => !mine.some((r) => r.id === id));
  const joined = memberIds.length
    ? await db.select().from(chatRooms).where(inArray(chatRooms.id, memberIds))
    : [];
  const rooms = [...mine, ...joined];
  if (!rooms.length) return NextResponse.json({ nodes: [], edges: [] });

  const states = await db
    .select()
    .from(agentRoomStates)
    .where(inArray(agentRoomStates.roomId, rooms.map((r) => r.id)));

  const nodes: GraphNode[] = rooms.map((r) => ({ id: r.id, label: r.name, kind: "room" }));
  const edges: GraphEdge[] = [];
  const roomIdSet = new Set(rooms.map((r) => r.id));
  const seen = new Set<string>();

  const addProvenance = (fromId: string, text: string) => {
    for (const m of text.matchAll(ROOM_LINK_RE)) {
      const roomId = m[1];
      if (!roomIdSet.has(roomId)) continue;
      const key = `${fromId}~${roomId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: fromId, target: roomId, kind: "provenance" });
    }
  };

 // --- OKF docs (current): build root/section nodes from the file tree -----
  const legacyRootIds = new Set<string>();
  for (const s of states) {
    if (s.rootOkfPath && nodeExists(s.rootOkfPath)) {
      const rootId = encodeId(s.rootOkfPath);
      const rootNode = readNode(s.rootOkfPath);
      nodes.push({
        id: rootId,
        label: rootNode?.title ?? s.rootOkfPath,
        kind: "root",
      });
      edges.push({ source: s.roomId, target: rootId, kind: "owns" });

      for (const rel of Object.values(s.sectionOkfPaths ?? {})) {
        if (!rel || !nodeExists(rel)) continue;
        const secId = encodeId(rel);
        const node = readNode(rel);
        nodes.push({ id: secId, label: node?.title ?? rel, kind: "section" });
        edges.push({ source: rootId, target: secId, kind: "contains" });
        if (node?.kind === "page") {
          for (const b of node.blocks) {
            const text = (b.content as { text?: string })?.text;
            if (typeof text === "string") addProvenance(secId, text);
          }
        }
      }
      continue;
    }
 // --- legacy (rooms whose docs lived in Postgres pages) ------------------
    if (s.rootPageId) {
      legacyRootIds.add(s.rootPageId);
      edges.push({ source: s.roomId, target: s.rootPageId, kind: "owns" });
    }
  }

  if (legacyRootIds.size) {
    const pageIds = new Set<string>(legacyRootIds);
    let frontier = [...pageIds];
    for (let depth = 0; depth < 5 && frontier.length; depth++) {
      const children = await db
        .select({ id: pages.id, parentPageId: pages.parentPageId })
        .from(pages)
        .where(inArray(pages.parentPageId, frontier));
      frontier = [];
      for (const c of children) {
        if (!pageIds.has(c.id)) {
          pageIds.add(c.id);
          frontier.push(c.id);
        }
        edges.push({ source: c.parentPageId!, target: c.id, kind: "contains" });
      }
    }
    const ids = [...pageIds];
    const pageRows = await db
      .select({ id: pages.id, title: pages.title, parentPageId: pages.parentPageId })
      .from(pages)
      .where(inArray(pages.id, ids));
    for (const p of pageRows) {
      nodes.push({
        id: p.id,
        label: p.title || "Untitled",
        kind: legacyRootIds.has(p.id)
          ? "root"
          : p.parentPageId && legacyRootIds.has(p.parentPageId)
            ? "section"
            : "page",
      });
    }
    const blockRows = await db
      .select({ pageId: blocks.pageId, type: blocks.type, content: blocks.content })
      .from(blocks)
      .where(inArray(blocks.pageId, ids));
    for (const b of blockRows) {
      const c = b.content as { childPageId?: string; text?: string };
      if (b.type === "link_to_page" && c?.childPageId && pageIds.has(c.childPageId)) {
        const key = `${b.pageId}>${c.childPageId}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: b.pageId, target: c.childPageId, kind: "link" });
        }
      }
      if (typeof c?.text === "string") addProvenance(b.pageId, c.text);
    }
  }

  return NextResponse.json({ nodes, edges });
}
