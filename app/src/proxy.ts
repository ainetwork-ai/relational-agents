import { NextResponse, type NextRequest } from "next/server";

/**
 * Hand the request path to server layouts. A layout cannot read its child
 * route's params, but the app layout must know WHICH page is being viewed to
 * draw the sidebar for that page's workspace on the first paint (QA-3: a
 * ComCom page opened while the personal workspace was active rendered the
 * personal sidebar around ComCom content). Measured on Notion 2026-09-09: the
 * opened page decides the workspace, so the chrome is derived from the page.
 *
 * Scoped to /p/* — the only routes whose chrome depends on the path.
 */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/p/:path*"] };
