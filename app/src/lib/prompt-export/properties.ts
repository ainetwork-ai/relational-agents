import type { PersonRef, PValue, RollupItem } from "./model";
import { idHex, richTextToMarkdown } from "./rich-text";

/**
 * notion2prompt's property rendering (src/formatting/properties): one markdown
 * string per value, "" when there is nothing to print (the line is then left out).
 * Pure.
 */

/** Rust `{:.2}` rounds an exact tie to even; JS toFixed rounds it up. Only x.125 / x.375 /
 *  x.625 / x.875 are exact ties at two decimals in binary, so only those need help. */
function fixed2(n: number): string {
  const e = n * 8;
  if (Number.isInteger(e) && e % 2 !== 0 && Math.abs(n) < 1e15) {
    const abs = Math.abs(n);
    const lo = Math.floor(abs * 100);
    const v = lo % 2 === 0 ? lo : lo + 1;
    const s = `${Math.floor(v / 100)}.${String(v % 100).padStart(2, "0")}`;
    return n < 0 ? `-${s}` : s;
  }
  return n.toFixed(2);
}

/** format_number_auto: integers bare, others to two places with trailing zeros cut. */
export function formatNumberAuto(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) {
    if (Object.is(n, -0)) return "-0";
    return Math.abs(n) < 1e21 ? n.toFixed(0) : BigInt(n).toString();
  }
  return fixed2(n).replace(/0+$/, "").replace(/\.$/, "");
}

const dateOnly = (s: string) => s.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? s;

/** created_time / last_edited_time: UTC `YYYY-MM-DD HH:MM` */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

const personLabel = (p: PersonRef) => p.name || p.email || `User ${p.id}`;

function rollupItem(i: RollupItem): string {
  switch (i.type) {
    case "title":
    case "rich_text":
      return richTextToMarkdown(i.richText);
    case "number":
      return String(i.number);
    case "date":
      return dateOnly(i.start);
    case "text":
      return i.text;
  }
}

export function renderPropertyValue(v: PValue | undefined): string {
  if (!v) return "";
  switch (v.type) {
    case "title":
    case "rich_text":
      return richTextToMarkdown(v.richText);
    case "number":
      return v.number === null || v.number === undefined ? "" : formatNumberAuto(v.number);
    case "select":
    case "status":
      return v.name ?? "";
    case "multi_select":
      return v.names.join(", ");
    case "date":
      if (!v.start) return "";
      return v.end ? `${dateOnly(v.start)} → ${dateOnly(v.end)}` : dateOnly(v.start);
    case "people":
      return v.people.map(personLabel).join(", ");
    case "files":
      return v.files.map((f) => `[${f.name}](${f.url})`).join(", ");
    case "checkbox":
      return v.checked ? "✅" : "⬜";
    case "url":
      return v.url ? `[${v.url}](${v.url})` : "";
    case "email":
    case "phone_number":
      return v.value ?? "";
    case "formula": {
      const f = v.formula;
      if (f.type === "string") return f.string ?? "";
      if (f.type === "number") return f.number === null ? "" : formatNumberAuto(f.number);
      if (f.type === "boolean") return f.boolean ? "Yes" : "No";
      return f.start ? dateOnly(f.start) : "";
    }
    case "relation":
      return v.ids.map(idHex).join(", ");
    case "rollup": {
      const r = v.rollup;
      switch (r.type) {
        case "number":
          return r.number === null ? "" : formatNumberAuto(r.number);
        case "date":
          return r.start ? dateOnly(r.start) : "";
        case "array":
          return r.items.map(rollupItem).join(", ");
        case "string":
          return r.string ?? "";
        case "boolean":
          return r.boolean ? "Yes" : "No";
        case "unsupported":
          return "[Unsupported Rollup]";
        case "incomplete":
          return "[Incomplete Rollup]";
      }
      return "";
    }
    case "created_time":
    case "last_edited_time":
      return formatDateTime(v.time);
    case "created_by":
    case "last_edited_by":
      return personLabel(v.user);
    case "unique_id":
      return v.number === null ? "" : `${v.prefix ?? ""}${v.number}`;
    case "verification":
      if (!v.state) return "";
      return v.verifiedBy ? `${v.state} (${v.verifiedBy})` : v.state;
  }
}

/** A date a row can be sorted by (notion2prompt's extract_date). */
export function dateOf(v: PValue | undefined): string | null {
  if (!v) return null;
  if (v.type === "date") return v.start ? dateOnly(v.start) : null;
  if (v.type === "rollup") {
    if (v.rollup.type === "date") return v.rollup.start ? dateOnly(v.rollup.start) : null;
    if (v.rollup.type === "array") {
      const d = v.rollup.items.find((i) => i.type === "date");
      return d && d.type === "date" ? dateOnly(d.start) : null;
    }
    return null;
  }
  if (v.type === "formula" && v.formula.type === "date") return v.formula.start ? dateOnly(v.formula.start) : null;
  if (v.type === "created_time" || v.type === "last_edited_time") return v.time.slice(0, 10);
  return null;
}

/** escape_for_table */
export function escapeForTable(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, "<br>").replace(/\r/g, "");
}

/** Column alignment by Notion type (PropertyType::default_alignment). */
export function alignmentOf(type: string): string {
  if (type === "number") return "---:";
  if (type === "date" || type === "created_time" || type === "last_edited_time" || type === "checkbox") return ":---:";
  return "---";
}

/** ainmem property type → the Notion type name notion2prompt prints in a schema. */
export const NOTION_TYPE: Record<string, string> = {
  title: "title",
  text: "rich_text",
  number: "number",
  select: "select",
  multi_select: "multi_select",
  status: "status",
  date: "date",
  person: "people",
  checkbox: "checkbox",
  url: "url",
  relation: "relation",
  formula: "formula",
  rollup: "rollup",
  email: "email",
  phone: "phone_number",
  files: "files",
  created_time: "created_time",
  last_edited_time: "last_edited_time",
  created_by: "created_by",
  last_edited_by: "last_edited_by",
};
