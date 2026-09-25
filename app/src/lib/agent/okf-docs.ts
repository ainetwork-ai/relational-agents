import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Frontmatter, ParsedBlock } from "@/lib/memory-parse";
import { encodeId, ensureFolder, nodeExists, readNode, writePage } from "@/lib/okf-store";
import type { RelationshipProfile } from "./profiles/types";

/**
 * 관계 문서의 OKF 저장.
 *
 * <OKF root>/관계 문서 — <방이름>-<room6>/
 * index.md 루트 (폴더 = 페이지)
 * 개요.md 섹션 5개 = 하위 페이지
 * 타임라인.md
 * …
 *
 * 채팅/봇/토큰 같은 런타임 상태는 Postgres에 남는다 — 노션 "문서"만 파일이다.
 */

export interface OkfDocTree {
  /** 문서 루트 폴더의 OKF 상대 경로 */
  rootPath: string;
  /** 섹션 key → .md 상대 경로 */
  sectionPaths: Record<string, string>;
}

/** 파일명으로 안전하게 (경로 구분자·제어문자 제거, 길이 제한). */
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
 * OKF `type` — relation-agent(읽기 담당)의 파서 계약: `type` 프론트매터가 없으면
 * OkfError로 문서를 거부한다. 허용값 Memory | Fact | Preference.
 * (docs/contract-alignment-relation-agent.md 결정 2)
 *
 * 섹션마다의 값은 프로필이 정한다 — 어떤 관계든 연대기 섹션은 Memory, 나머지는
 * Fact 라는 규칙 자체는 같지만 섹션 구성이 프로필마다 다르다.
 */
function sectionOkfType(profile: RelationshipProfile, sectionKey?: string): string {
  if (!sectionKey) return "Fact";
  return profile.sections.find((s) => s.key === sectionKey)?.okfType ?? "Fact";
}

/** 섹션(또는 루트) 파일의 프론트매터. 읽는 쪽이 파일만 보고 관계를 역추적할 수
 * 있도록 relationId·roomId를 같은 값으로 함께 박는다 (결정 4의 식별자 통일). */
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

/** 문서 루트를 앱 라우트에서 열 수 있는 페이지 id로 (/p/{id}). */
export function okfDocPageId(rootPath: string): string {
  return encodeId(rootPath);
}

/**
 * 폴더+섹션 파일을 보장한다. 이미 있으면 그대로 재사용(멱등).
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

 // 루트는 섹션으로 들어가는 목차다 — 죽은 텍스트가 아니라 링크 불릿으로.
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

/** 저장된 상태로 문서 트리를 **읽기 전용**으로 복원한다 (파일을 만들지 않음).
 * guard처럼 "문서가 있으면 참고, 없으면 스킵"인 경로에서 쓴다. */
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

/** 섹션들의 현재 본문(평문) — LLM 컨텍스트용. */
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

/** 섹션 파일 끝에 줄을 덧붙인다 (기존 내용 보존 — 통째 덮어쓰기 금지).
 * `meta`를 주면 기존 프론트매터 위에 덮어쓴다 — 계약 필드(type/relationId)가
 * 이전 버전에 없던 파일도 append 한 번으로 보정된다. */
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
