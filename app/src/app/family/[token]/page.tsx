"use client";
import { clearOfflineCaches } from "@/lib/offline/caches";
import { AinuiButton, AinuiForm } from "@/components/ainui/surface";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { connectAindrive, loadAindriveInfo, signInWithAindrive } from "@/lib/aindrive-client";
import { useT } from "@/i18n/provider";
import { LanguageSwitch } from "@/components/language-switch";

interface Invite {
  name: string;
  inviter: string | null;
  teamspace: { name: string; icon: string | null };
  workspace: string;
  accepted: boolean;
}

interface Category {
  key: string;
  label: string;
  icon: string;
  defaultOn: boolean;
  folders: { driveId: string; root: string }[];
}

type Phase = "loading" | "invalid" | "welcome" | "approving" | "choose" | "sharing" | "done";

/**
 * Where a family member lands from an invite (link or QR, on their phone).
 * One approval with aindrive signs them in and joins them; then they pick
 * what their phone shares — as categories, not folders — and that is all.
 * Outside the app's sign-in gate: the invite is the way in.
 */
export default function FamilyInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [cats, setCats] = useState<Category[]>([]);
  const [phoneOff, setPhoneOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedCount, setSharedCount] = useState(0);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/family-invite/${token}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/auth/me`).then((r) => (r.ok ? r.json() : { user: null })),
    ]).then(([inv, who]: [Invite | null, { user: { displayName: string } | null }]) => {
      if (!inv) return setPhase("invalid");
      setInvite(inv);
      setMe(who?.user ?? null);
      setPhase("welcome");
    });
  }, [token]);

  async function join() {
    setError(null);
    const r = await fetch(`/api/family-invite/${token}`, { method: "POST" });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      setPhase("welcome");
      return setError(d.error ?? t("Couldn't join. Please try again."));
    }
    const c = (await fetch(`/api/family-invite/${token}/categories`).then((x) => x.json())) as {
      drives: { online: boolean }[];
      categories: Category[];
    };
    setCats(c.categories);
    setPhoneOff(c.drives.length > 0 && c.drives.every((d) => !d.online));
    setPhase("choose");
  }

  async function approve() {
    setPhase("approving");
    setError(null);
    // signed in already → only connect aindrive if this account has none;
    // not signed in → the aindrive approval signs them in, too
    if (me) {
      const info = await loadAindriveInfo(true);
      if (!info.connected && !(await connectAindrive())) {
        setPhase("welcome");
        return setError(t("The aindrive approval didn't finish. Tap again."));
      }
    } else {
      const ok = await signInWithAindrive();
      if (!ok) {
        setPhase("welcome");
        return setError(t("The aindrive approval didn't finish. Tap again."));
      }
    }
    await join();
  }

  async function share(values: Record<string, unknown>) {
    const selected = Array.isArray(values.categories) ? values.categories : [];
    const folders = cats.filter((c) => selected.includes(c.key)).flatMap((c) => c.folders);
    if (!folders.length) return finish(0);
    setPhase("sharing");
    const r = await fetch(`/api/family-invite/${token}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folders }),
    });
    const d = (await r.json().catch(() => ({}))) as { shared?: string[]; error?: string };
    if (!r.ok) {
      setPhase("choose");
      return setError(d.error ?? t("Couldn't share."));
    }
    finish(d.shared?.length ?? 0);
  }

  function finish(n: number) {
    setSharedCount(n);
    setPhase("done");
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-neutral-50 px-5 py-12 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
      <LanguageSwitch className="mb-3" />
      <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-neutral-900">
        {phase === "loading" && <Loader2 className="mx-auto animate-spin text-neutral-400" />}
        {phase === "invalid" && (
          <p className="text-center text-sm text-neutral-500">{t("This invite has expired or doesn't exist. Ask for a new link.")}</p>
        )}
        {invite && (phase === "welcome" || phase === "approving") && (
          <div data-testid="family-invite-welcome" className="text-center">
            <div className="mb-3 text-5xl">{invite.teamspace.icon ?? "👪"}</div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
              {t("{inviter} invited you to 「{space}」", { inviter: invite.inviter ?? t("Family"), space: invite.teamspace.name })}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              {t("Share {name}'s phone photos and notes with the family. Files stay on the phone; only the folders you pick are visible.", { name: invite.name })}
            </p>
            <AinuiButton testId="family-invite-approve" onClick={approve} disabled={phase === "approving"} label={me ? t("Join as {name}", { name: me.displayName }) : t("Approve with aindrive")} />
            {!me && <p className="mt-2 text-[11px] text-neutral-400">{t("When aindrive opens, just tap [Approve].")}</p>}
            {me && (
              <AinuiButton testId="family-invite-other-account" label={t("Not {name}? Approve with another aindrive account", { name: me.displayName })} onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => clearOfflineCaches()).then(() => setMe(null))} />
            )}
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          </div>
        )}
        {(phase === "choose" || phase === "sharing") && (
          <div data-testid="family-invite-choose">
            <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{t("What should the family see?")}</h1>
            <p className="mb-4 mt-1 text-sm text-neutral-500">{t("Only what's on is visible to the family. You can change it anytime.")}</p>
            {phoneOff && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{t("aindrive on the phone is off. Turn it on and open this again.")}</p>}
            {cats.length === 0 && !phoneOff && <p className="text-sm text-neutral-500">{t("There are no folders on the phone to share yet.")}</p>}
            <AinuiForm testId="family-invite-share" fields={[{ key: "categories", label: t("What should the family see?"), multiple: true, value: cats.filter((c) => c.defaultOn).map((c) => c.key), options: cats.map((c) => ({ value: c.key, label: `${c.icon} ${t(c.label)} · ${c.folders.map((f) => f.root).join(", ")}` })) }]} disabled={phase === "sharing"} submitLabel={t("Share and start")} onSubmit={share} />
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          </div>
        )}
        {phase === "done" && invite && (
          <div data-testid="family-invite-done" className="text-center">
            <div className="mb-3 text-5xl">✅</div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t("You're connected!")}</h1>
            <p className="mt-2 text-sm text-neutral-500">
              {sharedCount
                ? t("{n} folders are shared to 「{space}」. New photos you take show up for the family too.", { n: sharedCount, space: invite.teamspace.name })
                : t("You've joined 「{space}」. You can share folders later.", { space: invite.teamspace.name })}
            </p>
            <AinuiButton label={t("Go to the family space")} onClick={() => router.push("/")} />
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
