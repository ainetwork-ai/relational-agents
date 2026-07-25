import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { aiChat } from "@/lib/ai";

export const dynamic = "force-dynamic";

interface RowCtx {
  rowId: string;
  context: Record<string, string>;
}

/** POST { propertyName, propertyType, options?, rows: [{rowId, context}] }
 *  → { values: { [rowId]: string } } — Notion AI database autofill.
 *  The CLIENT persists values through the normal row PATCH path, so OKF and
 *  Postgres behave identically. Select-ish targets must pick an option name. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const propertyName = typeof body?.propertyName === "string" ? body.propertyName : "";
  const propertyType = typeof body?.propertyType === "string" ? body.propertyType : "text";
  const options: string[] = Array.isArray(body?.options) ? body.options.slice(0, 30) : [];
  const rows: RowCtx[] = Array.isArray(body?.rows) ? body.rows.slice(0, 10) : [];
  if (!propertyName || !rows.length)
    return NextResponse.json({ error: "propertyName and rows required" }, { status: 400 });

  const constraint =
    options.length > 0
      ? `The value MUST be exactly one of: ${options.join(" | ")}.`
      : propertyType === "number"
        ? "The value must be a plain number."
        : "The value is a short piece of text (max ~15 words).";

  try {
    const listing = rows
      .map(
        (r, i) =>
          `${i + 1}. ${Object.entries(r.context)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ")}`
      )
      .join("\n");
    const raw = await aiChat(
      [
        {
          role: "system",
          content:
            `You fill in the "${propertyName}" field of database rows from their other fields. ` +
            `${constraint} Respond with ONE line per row, in order, formatted "N: value". Nothing else.`,
        },
        { role: "user", content: listing },
      ],
      { maxTokens: 400, temperature: 0.2 }
    );
    const values: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*(\d+)\s*[:.)-]\s*(.+)$/);
      if (!m) continue;
      const row = rows[Number(m[1]) - 1];
      if (!row) continue;
      let v = m[2].trim();
      if (options.length) {
        const hit = options.find((o) => o.toLowerCase() === v.toLowerCase());
        if (!hit) continue; // never invent an option
        v = hit;
      }
      values[row.rowId] = v;
    }
    return NextResponse.json({ values });
  } catch (err) {
    console.error("ai/autofill failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  }
}
