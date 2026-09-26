// POST /api/workspaces/[workspaceId]/ens/reserve { familyLabel } — hold <familyLabel>.eth for this
// workspace for 30 minutes before the first MetaMask approval
// (docs/superpowers/plans/2026-09-26-ens-family-settings.md, Task 6 Step 2, F14). Reads only.
// DELETE { familyLabel } drops this workspace's own hold (Cancel in the panel, Task 7).
import { NextRequest, NextResponse } from "next/server";
import { familyLabelStatus, getWorkspaceFamily, releaseLabel, reservationExpiry, reserveLabel, familySuggestions } from "@/lib/ens-workspace";
import { chainUnavailable, requireFamilyAdmin } from "../guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const a = await requireFamilyAdmin(workspaceId);
  if ("error" in a) return a.error;

  const body = await req.json().catch(() => ({}));
  if (typeof body?.familyLabel !== "string") {
    return NextResponse.json({ error: "familyLabel is required" }, { status: 400 });
  }
  if (await getWorkspaceFamily(workspaceId)) {
    return NextResponse.json({ reason: "exists", error: "This workspace already has a family name.", suggestions: [] }, { status: 409 });
  }

  let answer;
  try {
    answer = await familyLabelStatus(body.familyLabel, workspaceId);
  } catch (e) {
    return chainUnavailable(e);
  }
  if (answer.status === "invalid") {
    return NextResponse.json({ reason: answer.reason, error: "Not a valid .eth label", suggestions: answer.suggestions }, { status: 400 });
  }
  if (answer.status !== "free") {
    return NextResponse.json({ reason: answer.status, suggestions: answer.suggestions }, { status: 409 });
  }
  // another workspace may have taken the hold while the registry was being read
  if (reserveLabel(answer.label, workspaceId) === "reserved") {
    let suggestions: string[] = [];
    try {
      suggestions = await familySuggestions(answer.label, workspaceId);
    } catch {
      // the hold is the answer; suggestions are a nicety
    }
    return NextResponse.json({ reason: "reserved", suggestions }, { status: 409 });
  }
  const expiresAt = reservationExpiry(answer.label, workspaceId);
  return NextResponse.json({ label: answer.label, expiresAt: expiresAt?.toISOString() ?? null });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const a = await requireFamilyAdmin(workspaceId);
  if ("error" in a) return a.error;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.familyLabel !== "string") {
    return NextResponse.json({ error: "familyLabel is required" }, { status: 400 });
  }
  // only this workspace's hold; another workspace's stays
  releaseLabel(body.familyLabel, workspaceId);
  return NextResponse.json({ released: body.familyLabel.trim().toLowerCase() });
}
