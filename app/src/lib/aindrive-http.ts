import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AindriveError, deletePath, readFile, walkTree, writeFile, type AindriveLink } from "@/lib/aindrive";

/**
 * The HTTP side of browsing a linked folder, shared by every place a folder is
 * linked from (Home's personal link, a teamspace's drives). Each route resolves
 * its own link and access, then hands the request here.
 */

/** A bad path is the caller's mistake, a refusal is aindrive's call on that
 *  path, and anything else is the drive being unreachable or failing. */
function status(e: unknown): number {
  if (!(e instanceof AindriveError)) return 500;
  const msg = e.message;
  if (!msg.startsWith("aindrive ")) return 400;
  if (msg.includes("[forbidden]")) return 403;
  if (msg.includes("[not_found]") || msg.includes("ENOENT")) return 404;
  return 502;
}

const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: status(e) });

/** GET → { link, entries } — every file and folder in the linked folder. */
export async function treeResponse(link: AindriveLink) {
  try {
    return NextResponse.json({ link, entries: await walkTree(link) });
  } catch (e) {
    return fail(e);
  }
}

/** GET ?path= → { path, content } */
export async function readResponse(link: AindriveLink, req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  try {
    return NextResponse.json({ path, content: await readFile(link, path) });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE ?path= → delete a file, or a folder with its contents */
export async function deleteResponse(link: AindriveLink, req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  try {
    await deletePath(link, path);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return fail(e);
  }
}

/** PUT { path, content } → create or overwrite */
export async function writeResponse(link: AindriveLink, req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { path?: unknown; content?: unknown };
  if (typeof body.path !== "string" || typeof body.content !== "string")
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  try {
    await writeFile(link, body.path, body.content);
    return NextResponse.json({ ok: true, path: body.path });
  } catch (e) {
    return fail(e);
  }
}
