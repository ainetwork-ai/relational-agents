import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { PROFILES } from "@/lib/agent/profiles";

export const dynamic = "force-dynamic";

/**
 * GET → the relationship profiles an agent can run on.
 *
 * Built in for now, so this is a constant list; when profiles become something
 * people write, only this route changes shape and the settings form does not.
 * The sections travel with each profile because a picker that only shows names
 * asks people to guess what switching would do to their document.
 */
export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    profiles: PROFILES.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      docTitle: p.docTitle,
      docIcon: p.docIcon,
      sections: p.sections.map((s) => ({ key: s.key, title: s.title })),
      persona: p.persona,
      behavior: p.behavior,
    })),
  });
}
