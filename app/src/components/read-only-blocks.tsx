import type { Block } from "@/lib/db/schema";
import { Check, ChevronDown } from "lucide-react";
import { sanitizeInline } from "@/lib/rich-text";

/** Inline rich text for the public read-only view (sanitized twice: at write
 *  and again here at render). */
function Rich({ block, fallback }: { block: Block; fallback: string }) {
  if (block.content.html) {
    return (
      <span
        dangerouslySetInnerHTML={{ __html: sanitizeInline(block.content.html) }}
      />
    );
  }
  return <>{fallback}</>;
}

/** Static block renderer for the public /share/[token] view. No editing. */
export function ReadOnlyBlocks({ blocks }: { blocks: Block[] }) {
  const childrenOf = (parentId: string | null) =>
    blocks
      .filter((b) => (b.parentBlockId ?? null) === parentId)
      .sort((a, b) => a.position - b.position);

  return <div>{childrenOf(null).map((b) => renderBlock(b, childrenOf, 0))}</div>;
}

function renderBlock(
  b: Block,
  childrenOf: (id: string | null) => Block[],
  depth: number
): React.ReactNode {
  const text = b.content.text ?? "";
  const base = "text-[15px] leading-7 text-neutral-800 dark:text-neutral-200";

  switch (b.type) {
    case "heading1":
      return (
        <h2 key={b.id} className="pb-1 pt-4 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
          <Rich block={b} fallback={text} />
        </h2>
      );
    case "heading2":
      return (
        <h3 key={b.id} className="pb-0.5 pt-3 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          <Rich block={b} fallback={text} />
        </h3>
      );
    case "heading3":
      return (
        <h4 key={b.id} className="pb-0.5 pt-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          <Rich block={b} fallback={text} />
        </h4>
      );
    case "bulleted_list":
      return (
        <div key={b.id} className={`flex gap-2 py-0.5 ${base}`}>
          <span className="w-4 text-center">•</span>
          <span><Rich block={b} fallback={text} /></span>
        </div>
      );
    case "numbered_list":
      return (
        <div key={b.id} className={`flex gap-2 py-0.5 ${base}`}>
          <span className="w-4 text-right">·</span>
          <span><Rich block={b} fallback={text} /></span>
        </div>
      );
    case "todo":
      return (
        <div key={b.id} className="flex items-start gap-2 py-0.5">
          <span
            className={`mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
              b.content.checked
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-neutral-300 dark:border-neutral-600"
            }`}
          >
            {b.content.checked && <Check size={12} />}
          </span>
          <span
            className={
              b.content.checked ? "text-neutral-400 line-through" : base
            }
          >
            <Rich block={b} fallback={text} />
          </span>
        </div>
      );
    case "toggle":
      return (
        <div key={b.id} className="py-0.5">
          <div className={`flex items-center gap-1 font-medium ${base}`}>
            <ChevronDown size={16} className="text-neutral-500" />
            <Rich block={b} fallback={text} />
          </div>
          <div className="ml-5">
            {childrenOf(b.id).map((c) => renderBlock(c, childrenOf, depth + 1))}
          </div>
        </div>
      );
    case "quote":
      return (
        <blockquote
          key={b.id}
          className={`my-0.5 border-l-[3px] border-neutral-800 pl-3 italic dark:border-neutral-300 ${base}`}
        >
          <Rich block={b} fallback={text} />
        </blockquote>
      );
    case "divider":
      return <hr key={b.id} className="my-3 border-neutral-200 dark:border-neutral-700" />;
    case "code":
      return (
        <pre
          key={b.id}
          className="my-1 overflow-x-auto rounded-md bg-neutral-100 px-3 py-2 font-mono text-[13px] leading-6 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {text}
        </pre>
      );
    case "callout":
      return (
        <div
          key={b.id}
          className="my-1 flex items-start gap-2.5 rounded-md bg-neutral-100 px-3.5 py-3 dark:bg-neutral-800"
        >
          <span className="text-lg leading-6">💡</span>
          <span className={base}><Rich block={b} fallback={text} /></span>
        </div>
      );
    case "table": {
      const t = b.content.table;
      if (!t?.cells?.length) return null;
      return (
        <div key={b.id} className="my-1.5 overflow-x-auto">
          <table className="border-collapse text-sm">
            <tbody>
              {t.cells.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const header =
                      (t.headerRow && r === 0) || (t.headerCol && c === 0);
                    const Tag = header ? "th" : "td";
                    return (
                      <Tag
                        key={c}
                        className={`min-w-[100px] border border-neutral-200 px-2 py-1 text-left align-top dark:border-neutral-700 ${
                          header ? "bg-neutral-50 font-medium dark:bg-neutral-800/60" : ""
                        }`}
                      >
                        {cell}
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "database":
      // databases render live only in the editor; the public snapshot embeds
      // just the block, so show a neutral marker rather than crash.
      return (
        <div
          key={b.id}
          className="my-2 rounded-md border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-400 dark:border-neutral-700"
        >
          📊 Database
        </div>
      );
    case "image":
      return b.content.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={b.id}
          src={b.content.url}
          alt={text}
          className="my-1.5 max-h-[420px] rounded-md"
        />
      ) : null;
    default:
      return (
        <p key={b.id} className={`py-0.5 ${base}`}>
          <Rich block={b} fallback={text} />
        </p>
      );
  }
}
