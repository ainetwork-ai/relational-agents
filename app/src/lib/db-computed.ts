import type { DbProperty, DbRow } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Safe formula evaluation. Supports numbers, + - * / and parentheses, plus
// prop("Name") references that resolve to another property's numeric value on
// the SAME row. NO eval / new Function — a tokenizer + shunting-yard parser.
// ---------------------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lparen" }
  | { t: "rparen" };

/** Look up a property's numeric value on a row by the property NAME used in
 * a prop("…") reference. Missing / non-numeric resolves to 0. */
function propValueByName(
  name: string,
  props: DbProperty[],
  row: DbRow
): number {
  const p = props.find((pp) => pp.name === name);
  if (!p) return 0;
  const raw = row.values[p.id];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function tokenize(
  expr: string,
  props: DbProperty[],
  row: DbRow
): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rparen" });
      i++;
      continue;
    }
 // number literal
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i + 1;
      while (j < expr.length && ((expr[j] >= "0" && expr[j] <= "9") || expr[j] === ".")) j++;
      const n = Number(expr.slice(i, j));
      if (!Number.isFinite(n)) return null;
      tokens.push({ t: "num", v: n });
      i = j;
      continue;
    }
 // prop("Name") or prop('Name')
    if (expr.startsWith("prop", i)) {
      let j = i + 4;
      while (j < expr.length && expr[j] === " ") j++;
      if (expr[j] !== "(") return null;
      j++;
      while (j < expr.length && expr[j] === " ") j++;
      const quote = expr[j];
      if (quote !== '"' && quote !== "'") return null;
      j++;
      const start = j;
      while (j < expr.length && expr[j] !== quote) j++;
      if (j >= expr.length) return null;
      const name = expr.slice(start, j);
      j++; // closing quote
      while (j < expr.length && expr[j] === " ") j++;
      if (expr[j] !== ")") return null;
      j++;
      tokens.push({ t: "num", v: propValueByName(name, props, row) });
      i = j;
      continue;
    }
    return null; // unknown character
  }
  return tokens;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

/** Evaluate a token stream via shunting-yard into RPN, then fold. */
function evalTokens(tokens: Token[]): number | null {
  const output: (number | string)[] = [];
  const ops: (string)[] = [];
  for (const tk of tokens) {
    if (tk.t === "num") output.push(tk.v);
    else if (tk.t === "op") {
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        PREC[ops[ops.length - 1]] >= PREC[tk.v]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(tk.v);
    } else if (tk.t === "lparen") ops.push("(");
    else if (tk.t === "rparen") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
      if (!ops.length) return null; // mismatched
      ops.pop(); // discard "("
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return null; // mismatched
    output.push(op);
  }

  const stack: number[] = [];
  for (const tok of output) {
    if (typeof tok === "number") {
      stack.push(tok);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) return null;
    switch (tok) {
      case "+": stack.push(a + b); break;
      case "-": stack.push(a - b); break;
      case "*": stack.push(a * b); break;
      case "/": stack.push(b === 0 ? 0 : a / b); break;
      default: return null;
    }
  }
  return stack.length === 1 ? stack[0] : null;
}

/** Evaluate a formula expression for a row. Returns "" when the expression is
 * empty or invalid so the cell stays blank rather than showing NaN. */
export function evalFormula(
  expr: string | undefined,
  props: DbProperty[],
  row: DbRow
): string {
  if (!expr || !expr.trim()) return "";
  const tokens = tokenize(expr, props, row);
  if (!tokens || tokens.length === 0) return "";
  const result = evalTokens(tokens);
  if (result === null || !Number.isFinite(result)) return "";
 // integers render without a trailing ".0"
  return Number.isInteger(result) ? String(result) : String(result);
}

// ---------------------------------------------------------------------------
// Rollup aggregation: given the target rows' numeric values, fold by function.
// ---------------------------------------------------------------------------

export function aggregate(values: number[], fn: string | undefined): number {
  switch (fn) {
    case "count":
      return values.length;
    case "avg":
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case "sum":
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

/** Compute a rollup value string for a row given the linked target rows and the
 * target property id. Non-numeric target values count as 0 for sum/avg. */
export function rollupValue(
  linkedRows: DbRow[],
  targetPropertyId: string | undefined,
  fn: string | undefined
): string {
  if (!targetPropertyId) return "";
  const nums = linkedRows.map((r) => {
    const n = Number(r.values[targetPropertyId]);
    return Number.isFinite(n) ? n : 0;
  });
  const result = aggregate(nums, fn);
  return Number.isInteger(result) ? String(result) : String(result);
}
