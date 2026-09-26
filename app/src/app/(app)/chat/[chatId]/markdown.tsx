"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { copyText } from "@/lib/compat";
import { useT } from "@/i18n/provider";

/**
 * Lightweight markdown renderer for AI chat messages (no external deps).
 * Supports: # / ## / ### headings, **bold**, *italic*, inline `code`,
 * - / 1. lists, ```lang fenced code (with copy button + line numbers), |a|b|
 * tables, > quotes, $inline$ / $$block$$ math (display-only, no KaTeX), and
 * image grids (2+ consecutive `![alt](url)` lines) with an onerror fallback.
 * All raw text is HTML-escaped before any whitelist tag substitution — never
 * dangerouslySetInnerHTML with un-escaped source. Fenced code and table cells
 * are rendered as real React nodes so interactive bits (the copy button) work.
 */

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "codefence"; lang: string; code: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "blockquote"; lines: string[] }
  | { type: "mathblock"; content: string }
  | { type: "imagegrid"; items: { alt: string; src: string }[] };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape then apply a whitelist of inline transforms (bold/italic/code/math). */
function inlineFormat(raw: string): string {
  let s = escapeHtml(raw);
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return ` CODE${codeSpans.length - 1} `;
  });
 // Inline math `$...$` — display-only (no KaTeX): keep the raw $-delimited
 // text but tag it so it's identifiable/stylable. Extracted after code spans
 // (so `$` inside inline `code` is protected) and before bold/italic (so `*`
 // inside an expression isn't misread as emphasis).
  const mathSpans: string[] = [];
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, expr: string) => {
    mathSpans.push(expr);
    return ` MATHINLINE${mathSpans.length - 1} `;
  });
  const linkSpans: string[] = [];
  const stash = (html: string) => {
    linkSpans.push(html);
    return ` L${linkSpans.length - 1} `;
  };
  const isSafeUrl = (u: string) => /^(https?:\/\/|mailto:)/i.test(u);
  const anchor = (href: string, text: string) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline underline-offset-2 hover:text-blue-600 dark:text-blue-400">${text}</a>`;
  s = s.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) =>
    isSafeUrl(url) ? stash(anchor(url, text)) : m
  );
  s = s.replace(/https?:\/\/[^\s<]+/g, (url: string) => {
    const trail = url.match(/[.,!?)\]]+$/)?.[0] ?? "";
    const clean = trail ? url.slice(0, url.length - trail.length) : url;
    return stash(anchor(clean, clean)) + trail;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(
    / MATHINLINE(\d+) /g,
    (_m, i: string) => `<span data-testid="math-inline">$${mathSpans[Number(i)]}$</span>`
  );
  s = s.replace(/ CODE(\d+) /g, (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`);
  s = s.replace(/ L(\d+) /g, (_m, i: string) => linkSpans[Number(i)]);
  return s;
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
/** A line consisting of *only* one `![alt](url)` (used to detect image grids). */
const SOLO_IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/**
 * Renders one markdown image: clickable (opens the lightbox) and, if the
 * `src` fails to load, swaps to a text fallback showing the alt text instead
 * of a broken-image icon.
 */
function MdImage({
  src,
  alt,
  onImageClick,
}: {
  src: string;
  alt: string;
  onImageClick: (src: string, alt: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const t = useT();
  if (failed) {
    return (
      <div
        data-testid="md-image-fallback"
        className="my-1 flex min-h-16 items-center justify-center rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
      >
        {alt || t("Couldn't load image")}
      </div>
    );
  }
  return (
 // eslint-disable-next-line @next/next/no-img-element -- chat markdown renders arbitrary remote URLs, not a Next-optimizable local asset
    <img
      data-testid="md-image"
      src={src}
      alt={alt}
      onClick={() => onImageClick(src, alt)}
      onError={() => setFailed(true)}
      className="my-1 max-h-64 max-w-full cursor-zoom-in rounded-md border border-neutral-200 align-middle dark:border-neutral-700"
    />
  );
}

/**
 * Split one raw (unescaped) markdown line into React nodes: `![alt](url)`
 * spans become clickable `<img>` nodes (lightbox opened via callback), and
 * the surrounding text still goes through `inlineFormat` (escape + bold/
 * italic/code) exactly as before. Keeps images out of the same
 * dangerouslySetInnerHTML string so the click handler can be a real React
 * event (not an inline HTML attribute).
 */
function renderInlineNodes(
  line: string,
  keyPrefix: string,
  onImageClick: (src: string, alt: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(IMAGE_RE);
  let lastIndex = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > lastIndex) {
      nodes.push(
        <span
          key={`${keyPrefix}-t${n}`}
          dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(lastIndex, m.index)) }}
        />
      );
    }
    const alt = m[1];
    const src = m[2];
    nodes.push(
      <MdImage key={`${keyPrefix}-i${n}`} src={src} alt={alt} onImageClick={onImageClick} />
    );
    n++;
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length || nodes.length === 0) {
    nodes.push(
      <span
        key={`${keyPrefix}-t${n}`}
        dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(lastIndex)) }}
      />
    );
  }
  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fenceMatch = line.match(/^```\s*(\S*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or end of input)
      blocks.push({ type: "codefence", lang, code: codeLines.join("\n") });
      continue;
    }

 // Block math: `$$...$$` on its own line.
    const blockMathMatch = line.trim().match(/^\$\$(.+)\$\$$/);
    if (blockMathMatch) {
      blocks.push({ type: "mathblock", content: blockMathMatch[1] });
      i++;
      continue;
    }

 // Image grid: 2+ consecutive lines that are each *only* `![alt](url)`.
    if (SOLO_IMAGE_RE.test(line.trim())) {
      const items: { alt: string; src: string }[] = [];
      let j = i;
      while (j < lines.length) {
        const soloMatch = lines[j].trim().match(SOLO_IMAGE_RE);
        if (!soloMatch) break;
        items.push({ alt: soloMatch[1], src: soloMatch[2] });
        j++;
      }
      if (items.length >= 2) {
        blocks.push({ type: "imagegrid", items });
        i = j;
        continue;
      }
 // A single standalone image line falls through to normal paragraph
 // handling below, exactly as before (no regression for lone images).
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (
      /^\|.*\|$/.test(line.trim()) &&
      lines[i + 1] &&
      /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim())
    ) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const ordered = !!olMatch;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? lines[i].match(/^\d+\.\s+(.*)$/) : lines[i].match(/^[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^\|.*\|$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", lines: paraLines });
  }
  return blocks;
}

const COLLAPSE_LINE_THRESHOLD = 12;

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const lineCount = code.split("\n").length;
  const [collapsed, setCollapsed] = useState(lineCount > COLLAPSE_LINE_THRESHOLD);
  const t = useT();

  async function handleCopy() {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800/80">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-1 dark:border-neutral-700">
        <span
          data-testid="code-lang-label"
          className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400"
        >
          {lang || "text"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="code-collapse"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            {collapsed ? t("Expand") : t("Collapse")}
          </button>
          <button
            type="button"
            data-testid="code-copy"
            onClick={handleCopy}
            className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
      </div>
      <div
        className={`flex overflow-x-auto p-3 text-xs ${collapsed ? "max-h-28 overflow-y-hidden" : ""}`}
      >
        <div
          data-testid="code-linenumbers"
          aria-hidden="true"
          className="mr-3 select-none text-right text-neutral-400 dark:text-neutral-500"
        >
          {code.split("\n").map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>
        <pre className="min-w-0 flex-1">
          <code className={lang ? `language-${lang}` : undefined}>{code}</code>
        </pre>
      </div>
    </div>
  );
}

function renderBlock(
  block: Block,
  key: number,
  onImageClick: (src: string, alt: string) => void
): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const html = inlineFormat(block.text);
      const cls =
        block.level === 1
          ? "text-xl font-semibold"
          : block.level === 2
            ? "text-lg font-semibold"
            : "text-base font-semibold";
      const Tag = `h${block.level}` as "h1" | "h2" | "h3";
      return (
        <Tag
          key={key}
          className={`${cls} break-words text-neutral-900 dark:text-neutral-100`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    case "paragraph": {
      return (
        <p key={key} className="break-words text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
          {block.lines.map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {renderInlineNodes(line, `p${key}-${li}`, onImageClick)}
            </span>
          ))}
        </p>
      );
    }
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag
          key={key}
          className={`ml-5 space-y-1 break-words text-sm text-neutral-800 dark:text-neutral-200 ${
            block.ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {block.items.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
          ))}
        </ListTag>
      );
    }
    case "codefence":
      return <CodeBlock key={key} lang={block.lang} code={block.code} />;
    case "table":
      return (
        <div key={key} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((h, idx) => (
                  <th
                    key={idx}
                    className="border border-neutral-200 bg-neutral-50 px-2 py-1 text-left font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                    dangerouslySetInnerHTML={{ __html: inlineFormat(h) }}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-neutral-200 px-2 py-1 text-neutral-800 dark:border-neutral-700 dark:text-neutral-200"
                      dangerouslySetInnerHTML={{ __html: inlineFormat(cell) }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "blockquote": {
      const html = block.lines.map((l) => inlineFormat(l)).join("<br/>");
      return (
        <blockquote
          key={key}
          className="break-words border-l-2 border-neutral-300 pl-3 text-sm italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    case "mathblock":
 // Rendered as a plain text child (not dangerouslySetInnerHTML) so React
 // escapes it automatically — no raw HTML injection via math content.
      return (
        <div
          key={key}
          data-testid="math-block"
          className="my-2 overflow-x-auto rounded-md bg-neutral-100 p-3 text-center font-mono text-sm text-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-200"
        >
          {block.content}
        </div>
      );
    case "imagegrid":
      return (
        <div key={key} data-testid="md-image-grid" className="my-2 grid grid-cols-2 gap-2">
          {block.items.map((it, idx) => (
            <MdImage
              key={idx}
              src={it.src}
              alt={it.alt}
              onImageClick={onImageClick}
            />
          ))}
        </div>
      );
    default:
      return null;
  }
}

export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);
 // only one lightbox opens per message, so it renders outside the block tree (as a sibling) —
 // avoiding the invalid HTML of a <div> nested inside a <p>.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const t = useT();
  return (
    // min-w-0 + overflow-wrap:anywhere: long URLs/tokens wrap instead of causing horizontal scroll.
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      {blocks.map((b, idx) => renderBlock(b, idx, (src, alt) => setLightbox({ src, alt })))}
      {lightbox && (
        <div
          data-testid="md-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote URL, not a Next-optimizable local asset */}
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="max-h-full max-w-full rounded-md object-contain"
          />
          <button
            type="button"
            data-testid="md-lightbox-close"
            aria-label={t("Close")}
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
