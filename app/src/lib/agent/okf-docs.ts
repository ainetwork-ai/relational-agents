import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Frontmatter, ParsedBlock } from "@/lib/memory-parse";
import { encodeId, ensureFolder, nodeExists, readNode, writePage } from "@/lib/okf-store";
import type { RelationshipProfile } from "./profiles/types";

/**
 * OKF storage for relationship documents.
 *
 * <OKF root>/<doc title> — <room name>-<room6>/
 * index.md             root (folder = page)
 * <Overview>.md        one file per section = subpages
 * <Timeline>.md
 * …
 *
 * Runtime state such as chat, bots and tokens stays in Postgres — only the Notion-style "documents" are files.
 */

export interface OkfDocTree {
  /** OKF-relative path of the document root folder */
  rootPath: string;
  /** section key → relative .md path */
  sectionPaths: Record<string, string>;
}

/** Make safe as a file name (strip path separators and control characters, cap the length). */
function safeName(s: string): string {
  return (
    s
      .replace(/[/\\:*?"<>|\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "untitled"
  );
}

export function docRootTitle(roomName: string, profile: RelationshipProfile): string {
  return `${profile.docTitle} — ${roomName}`;
}

/**
 * OKF `type` — the parser contract of relation-agent (the reading side): without
 * a `type` front-matter field it rejects the document with OkfError. Allowed
 * values: Memory | Fact | Preference.
 * (docs/contract-alignment-relation-agent.md, decision 2)
 *
 * The value per section is set by the profile — the rule itself is the same for
 * every relationship (the chronicle section is Memory, the rest are Fact), but
 * which sections exist differs by profile.
 */
function sectionOkfType(profile: RelationshipProfile, sectionKey?: string): string {
  if (!sectionKey) return "Fact";
  return profile.sections.find((s) => s.key === sectionKey)?.okfType ?? "Fact";
}

/** Front matter of a section (or root) file. relationId and roomId are written
 * together with the same value so a reader can trace the relationship back from
 * the file alone (decision 4: one identifier). */
export function okfDocMeta(
  roomId: string,
  profile: RelationshipProfile,
  sectionKey?: string,
  extra: Frontmatter = {}
): Frontmatter {
  return {
    type: sectionOkfType(profile, sectionKey),
    relationId: roomId,
    roomId,
    ...extra,
  };
}

/** The document root as a page id the app route can open (/p/{id}). */
export function okfDocPageId(rootPath: string): string {
  return encodeId(rootPath);
}

/**
 * Ensures the folder and the section files. Reuses them as-is when they exist (idempotent).
 *
 * CALLER CONTRACT: this WRITES the folder to disk, and the OKF tree has no
 * permissions of its own — an unregistered path is workspace-readable (see
 * okf-acl.ts: "Unregistered paths stay workspace-shared"). Every caller must
 * follow it with setOkfAcl(tree.rootPath, roomId, participants), or the
 * relationship record is left open to the whole workspace.
 */
export function ensureOkfDocTree(
  roomId: string,
  roomName: string,
  profile: RelationshipProfile,
  saved?: { rootPath?: string | null; sectionPaths?: Record<string, string> | null }
): OkfDocTree {
  const rootPath =
    saved?.rootPath && nodeExists(saved.rootPath)
      ? saved.rootPath
      : `${safeName(docRootTitle(roomName, profile))}-${roomId.slice(0, 6)}`;

  ensureFolder(rootPath);

 // A profile change adds sections and relabels others; it never moves or drops
 // a file. A key kept between profiles therefore keeps its history — the
 // romance's "Timeline" and the working record's "Meeting log" are one file.
 //
 // Sections the *previous* profile had are carried along: their files stay on
 // disk either way, and dropping them from the map would leave pages nothing
 // links to and nothing can find again.
  const sectionPaths: Record<string, string> = {};
  for (const [key, rel] of Object.entries(saved?.sectionPaths ?? {}))
    if (rel && nodeExists(rel)) sectionPaths[key] = rel;
  for (const s of profile.sections) {
    const savedPath = saved?.sectionPaths?.[s.key];
    sectionPaths[s.key] =
      savedPath && nodeExists(savedPath)
        ? savedPath
        : path.posix.join(rootPath, `${safeName(s.title)}.md`);
  }

 // The root is a table of contents into the sections — link bullets, not dead text.
 // The index is the table of contents, so it is rewritten whenever the section
 // set changes — a new section that nothing links to is a file nobody finds.
  const indexRel = path.posix.join(rootPath, "index.md");
 // profile order first, then anything an earlier profile left behind — a
 // section that is no longer written to is still part of the record
  const carried = Object.keys(sectionPaths).filter(
    (k) => !profile.sections.some((s) => s.key === k)
  );
  const listed = [
    ...profile.sections.map((s) => ({ key: s.key, title: s.title })),
    ...carried.map((k) => ({ key: k, title: sectionTitleOf(sectionPaths[k], k) })),
  ];
  const indexBlocks = [
    block("paragraph", `A ${profile.voice.subject} document the agent maintains from this room's conversation.`, 1),
    ...listed.map((s, i) =>
      block("bulleted_list", `[${s.title}](/p/${encodeId(sectionPaths[s.key])})`, i + 2)
    ),
  ];
  const indexNode = nodeExists(indexRel) ? readNode(indexRel) : null;
  const indexStale =
    !indexNode ||
    indexNode.kind !== "page" ||
    listed.some(
      (s) => !indexNode.blocks.some((b) => ((b.content ?? {}) as { text?: string }).text?.includes(`[${s.title}]`))
    );
  if (indexStale)
    writePage(
      rootPath,
      docRootTitle(roomName, profile),
      okfDocMeta(roomId, profile, undefined, { icon: profile.docIcon }),
      indexBlocks
    );

  for (const s of profile.sections) {
    const rel = sectionPaths[s.key];
    if (!nodeExists(rel)) {
      writePage(rel, s.title, okfDocMeta(roomId, profile, s.key), []);
      continue;
    }
   // Existing file, possibly under an older profile's label: keep the blocks
   // and the path, refresh the title and the contract frontmatter.
    const node = readNode(rel);
   // node.title comes from the body's H1 (parseMarkdown prefers it over the
   // frontmatter), so a file relabelled once can still carry the old name in
   // its own metadata. Repair when either disagrees with the profile.
    const stale =
      node && node.kind === "page" && (node.title !== s.title || node.meta.title !== s.title);
    if (node && node.kind === "page" && stale) {
     // writePage spreads meta *after* the title argument, so a stale
     // frontmatter `title` would shadow the new label and leave the file
     // renamed in its body but not in its own metadata. Same for timestamp,
     // which must be restamped rather than carried over.
      const { title: _stale, timestamp: _restamped, ...carried } = node.meta;
      writePage(rel, s.title, { ...carried, ...okfDocMeta(roomId, profile, s.key) }, node.blocks);
    }
  }
  return { rootPath, sectionPaths };
}

/** Restores the document tree from saved state **read-only** (creates no files).
 * Used on paths like the guard: "consult the document if there is one, skip if not". */
export function okfDocTreeFromState(
  state: { rootOkfPath?: string | null; sectionOkfPaths?: Record<string, string> | null } | undefined,
  profile: RelationshipProfile
): OkfDocTree | null {
  const rootPath = state?.rootOkfPath;
  if (!rootPath || !nodeExists(rootPath)) return null;
  const sectionPaths: Record<string, string> = {};
 // Saved paths first (they include sections an earlier profile added), then
 // this profile's — same order ensureOkfDocTree builds them in, so a read-only
 // caller sees exactly the document a writer would.
  for (const [key, rel] of Object.entries(state?.sectionOkfPaths ?? {}))
    if (rel && nodeExists(rel)) sectionPaths[key] = rel;
  for (const s of profile.sections) {
    const rel = state?.sectionOkfPaths?.[s.key];
    if (rel && nodeExists(rel)) sectionPaths[s.key] = rel;
  }
  return { rootPath, sectionPaths };
}

/** A leftover section's own title, so the index can name it as the file does. */
export function sectionTitleOf(rel: string, fallback: string): string {
  const node = nodeExists(rel) ? readNode(rel) : null;
  return node && node.kind === "page" && node.title ? node.title : fallback;
}

function block(type: ParsedBlock["type"], text: string, position: number): ParsedBlock {
  return { id: randomUUID(), type, content: { text }, position };
}

/** The sections' current bodies (plain text) — for LLM context. */
export function readOkfSectionTexts(
  tree: OkfDocTree,
  profile: RelationshipProfile
): Record<string, string> {
  const out: Record<string, string> = {};
 // Everything the tree holds, not just what this profile writes to. A section
 // an earlier profile filled stays in the document and in the index, so a
 // reader can open it — an agent that skipped it would answer "nothing in the
 // record" about a page its own members are looking at, and the guard would
 // wave through a draft that contradicts it.
  for (const key of Object.keys(tree.sectionPaths)) {
    const rel = tree.sectionPaths[key];
    const s = { key };
    if (!rel) {
      out[s.key] = "";
      continue;
    }
    const node = rel && nodeExists(rel) ? readNode(rel) : null;
    out[s.key] =
      node && node.kind === "page"
        ? node.blocks
            .map((b) => {
              const c = (b.content ?? {}) as { text?: string; url?: string };
              // image blocks carry no text, so a text-only projection hid every
              // photo from the agent — it could neither mention nor attach one
              if (b.type === "image" && c.url) return `![${c.text ?? ""}](${c.url})`;
              return c.text ?? "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
  }
  return out;
}

/** key → display title for every section the tree holds: this profile's label
 *  where it has one, the file's own heading for anything an earlier profile
 *  left behind. */
export function sectionTitles(
  tree: OkfDocTree,
  profile: RelationshipProfile
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rel] of Object.entries(tree.sectionPaths))
    out[key] = profile.sections.find((s) => s.key === key)?.title ?? sectionTitleOf(rel, key);
  return out;
}

export interface NewLine {
  type: ParsedBlock["type"];
  text: string;
  /** image blocks render from content.url — text is kept as the caption. */
  url?: string;
  /** callout blocks: emoji icon (the profile's event icon, e.g. 🏡 gathering / 🌕 holiday) */
  icon?: string;
}

/** Appends lines to the end of a section file (keeps existing content — never overwrite the whole file).
 * Given `meta`, it is written over the existing front matter — so a file from an
 * earlier version that lacks the contract fields (type/relationId) is fixed by a single append. */
export function appendOkfLines(
  relPath: string,
  fallbackTitle: string,
  lines: NewLine[],
  meta?: Frontmatter
): void {
  if (!lines.length) return;
  const node = nodeExists(relPath) ? readNode(relPath) : null;
  const existing: ParsedBlock[] = node && node.kind === "page" ? node.blocks : [];
  const title = node && node.kind === "page" && node.title ? node.title : fallbackTitle;
 // title and timestamp are writePage's to set: it takes the title as an
 // argument and restamps on every write, but spreads meta afterwards — so
 // carrying the old values here would shadow both and freeze a file under a
 // name it no longer has.
  const { title: _staleTitle, timestamp: _restamped, ...existingMeta } = (
    node && node.kind === "page" ? node.meta : {}
  ) as Frontmatter;
  const merged: Frontmatter = { ...existingMeta, ...(meta ?? {}) };
  // Same-day timeline events merge under one date heading: when the appended
  // block starts with an h1 the file already ends its h1 sequence with,
  // drop the duplicate so "# 2026-07-25" appears once per day, not per write.
  if (lines[0]?.type === "heading1") {
    const lastH1 = [...existing].reverse().find((b) => b.type === "heading1");
    if (lastH1 && (lastH1.content as { text?: string }).text === lines[0].text) lines = lines.slice(1);
  }
  if (!lines.length) return;
  let pos = existing.reduce((m, b) => Math.max(m, b.position ?? 0), 0);
  const added = lines.map((l) => {
    const b = block(l.type, l.text, ++pos);
    const c = b.content as { url?: string; caption?: string; icon?: string; text?: string };
    if (l.url) c.url = l.url;
    // the image renderer (and the md serializer's ![caption](url)) read the
    // caption field — mirror the text there so it survives the round-trip
    if (l.type === "image" && l.text) {
      c.caption = l.text;
      c.text = "";
    }
    if (l.icon) c.icon = l.icon;
    return b;
  });
  writePage(relPath, title, merged, [...existing, ...added]);
}
