import type { ParsedBlock } from "@/lib/memory-parse";

/** Export accepts flat OKF blocks and nested Postgres blocks alike. */
export type ExportBlock = ParsedBlock & { parentBlockId?: string | null };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline: prefer the sanitized rich html a block already carries. */
function inline(b: ExportBlock): string {
  const html = b.content.html;
  if (typeof html === "string" && html) return html;
  return esc(b.content.text ?? "");
}

/** Render blocks to print-ready HTML for the PDF exporter. Children are
 * nested by parentBlockId (toggles/columns flattened — print is linear). */
export function blocksToHtml(title: string, blocksIn: ExportBlock[]): string {
  const byParent = new Map<string | null, ExportBlock[]>();
  for (const b of blocksIn) {
    const key = b.parentBlockId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(b);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

  const walk = (parent: string | null): string => {
    const out: string[] = [];
    let listBuf: string[] = [];
    let listTag: "ul" | "ol" | null = null;
    const flushList = () => {
      if (listTag && listBuf.length) out.push(`<${listTag}>${listBuf.join("")}</${listTag}>`);
      listBuf = [];
      listTag = null;
    };
    for (const b of byParent.get(parent) ?? []) {
      const kids = walk(b.id);
      const asList = (tag: "ul" | "ol", li: string) => {
        if (listTag !== tag) flushList();
        listTag = tag;
        listBuf.push(li);
      };
      switch (b.type) {
        case "heading1": flushList(); out.push(`<h1>${inline(b)}</h1>${kids}`); break;
        case "heading2": flushList(); out.push(`<h2>${inline(b)}</h2>${kids}`); break;
        case "heading3": flushList(); out.push(`<h3>${inline(b)}</h3>${kids}`); break;
        case "bulleted_list": asList("ul", `<li>${inline(b)}${kids}</li>`); break;
        case "numbered_list": asList("ol", `<li>${inline(b)}${kids}</li>`); break;
        case "todo":
          flushList();
          out.push(
            `<div class="todo">${b.content.checked ? "☑" : "☐"} ${inline(b)}</div>${kids}`
          );
          break;
        case "toggle": flushList(); out.push(`<div><b>▸ ${inline(b)}</b>${kids}</div>`); break;
        case "quote": flushList(); out.push(`<blockquote>${inline(b)}${kids}</blockquote>`); break;
        case "callout": flushList(); out.push(`<div class="callout">${esc(String(b.content.icon ?? "💡"))} ${inline(b)}${kids}</div>`); break;
        case "divider": flushList(); out.push("<hr/>"); break;
        case "code":
          flushList();
          out.push(`<pre><code>${esc(b.content.text ?? "")}</code></pre>`);
          break;
        case "image":
          flushList();
          if (b.content.url) out.push(`<img src="${esc(String(b.content.url))}" />`);
          break;
        case "equation":
          flushList();
          if (b.content.text) out.push(`<pre class="eq">${esc(b.content.text)}</pre>`);
          break;
        case "table": {
          flushList();
          const t = b.content.table;
          if (t?.cells?.length) {
            const rowsHtml = t.cells
              .map(
                (r, ri) =>
                  `<tr>${r
                    .map((c) =>
                      t.headerRow && ri === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`
                    )
                    .join("")}</tr>`
              )
              .join("");
            out.push(`<table>${rowsHtml}</table>`);
          }
          break;
        }
        case "column_list":
        case "column":
          flushList();
          out.push(kids); // print linearly
          break;
        case "toc":
        case "template_button":
          flushList();
          break; // interactive-only
        default:
          flushList();
          out.push(`<p>${inline(b)}</p>${kids}`);
      }
    }
    flushList();
    return out.join("\n");
  };

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
         max-width: 46rem; margin: 2rem auto; color: #222; line-height: 1.6; }
  h1 { font-size: 1.9rem; margin: 1.2rem 0 .4rem; } h2 { font-size: 1.4rem; margin: 1rem 0 .3rem; }
  h3 { font-size: 1.15rem; margin: .8rem 0 .25rem; }
  blockquote { border-left: 3px solid #ccc; margin: .4rem 0; padding: .1rem .8rem; color: #555; }
  .callout { background: #f6f6f4; border-radius: 6px; padding: .6rem .8rem; margin: .4rem 0; }
  pre { background: #f6f6f4; border-radius: 6px; padding: .7rem; overflow-x: auto; font-size: .85em; }
  table { border-collapse: collapse; margin: .5rem 0; } td, th { border: 1px solid #ddd; padding: .25rem .6rem; }
  img { max-width: 100%; } hr { border: none; border-top: 1px solid #ddd; margin: 1rem 0; }
  .todo { margin: .15rem 0; }
  </style></head><body><h1 class="title">${esc(title || "Untitled")}</h1>\n${walk(null)}</body></html>`;
}
