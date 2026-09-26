import type { Page } from "@/lib/db/schema";

/** A page row as the client sees it: the API adds isDatabase, which no column
 *  carries — a page "is" a database when its body is a full-page database block —
 *  and isRow, true when the page IS a database entry's body. */
export type PageRow = Page & { isDatabase?: boolean; isRow?: boolean };

/**
 * What to call an untitled page. Returns the English source key — wrap in t() at the render site.
 *
 * Notion names an untitled database page "New database" rather than Untitled, in
 * the sidebar as well as in the title field, because "Untitled" would describe
 * a document it is not. Same fallback in one place so the sidebar, breadcrumb
 * and title never disagree.
 */
export function pageLabel(page: { title: string; isDatabase?: boolean }): string {
  if (page.title) return page.title;
  return page.isDatabase ? "New database" : "Untitled";
}

/** Fallback glyph when a page has no icon of its own. */
export function pageFallbackIcon(page: { isDatabase?: boolean }): string {
  return page.isDatabase ? "🗒" : "📄";
}
