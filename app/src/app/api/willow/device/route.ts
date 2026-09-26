import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getAccount, runAs } from "@/lib/aindrive-account";
import { aindriveHttp } from "@/lib/aindrive";
import { deviceBinding } from "@/lib/willow/binding";

export const dynamic = "force-dynamic";

/**
 * POST /api/willow/device { deviceKey } → { cert, binding }
 *
 * This browser's device key, certified by aindrive for the person's own connected
 * aindrive account (aindrive's /api/willow/cert, "vouched by aindrive"), plus
 * ainmem's binding of the key to this ainmem user. With both, the browser signs
 * its edits in teamspaces linked to aindrive (docs/willow-ainmem-plan.md Task 5).
 * 409 when the person has no aindrive account connected: their edits stay unsigned.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { deviceKey?: unknown } | null;
  const deviceKey = typeof body?.deviceKey === "string" ? body.deviceKey : "";
  if (!/^[0-9a-f]{64}$/.test(deviceKey)) return NextResponse.json({ error: "deviceKey" }, { status: 400 });
  const userId = session.userId;
  if (!(await getAccount(userId))) return NextResponse.json({ error: "connect aindrive" }, { status: 409 });
  try {
    const res = await runAs(userId, () =>
      aindriveHttp("/api/willow/cert", { method: "POST", body: JSON.stringify({ deviceKey, label: "ainmem browser" }) }, 10_000)
    );
    const data = (await res.json().catch(() => ({}))) as { cert?: unknown; error?: string };
    if (!res.ok || !data.cert) return NextResponse.json({ error: data.error ?? `aindrive ${res.status}` }, { status: res.status === 403 ? 403 : 502 });
    return NextResponse.json({ cert: data.cert, binding: deviceBinding(userId, deviceKey) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
