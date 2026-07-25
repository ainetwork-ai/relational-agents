import { NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { requireAuth } from "@/lib/auth/middleware";
import { importNotionZip } from "@/lib/memory-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// large exports (hundreds of MB) — allow a generous body
export const maxDuration = 300;

/** POST a Notion export .zip → unzips it into the OKF content root as pages. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: "expected a .zip export" }, { status: 415 });
  }

  const dir = await mkdir(path.join(os.tmpdir(), "notion-uploads"), { recursive: true });
  const tmpZip = path.join(
    dir ?? path.join(os.tmpdir(), "notion-uploads"),
    `${crypto.randomUUID()}.zip`
  );
  await writeFile(tmpZip, Buffer.from(await file.arrayBuffer()));

  try {
    const result = await importNotionZip(tmpZip, file.name);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 }
    );
  } finally {
    await rm(tmpZip, { force: true }).catch(() => {});
  }
}
