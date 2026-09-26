"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, HardDrive, Loader2 } from "lucide-react";
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
  const [on, setOn] = useState<Set<string>>(new Set());
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
    setOn(new Set(c.categories.filter((x) => x.defaultOn).map((x) => x.key)));
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

  async function share() {
    const folders = cats.filter((c) => on.has(c.key)).flatMap((c) => c.folders);
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

  const toggle = (k: string) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

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
            <button
              data-testid="family-invite-approve"
              onClick={() => void approve()}
              disabled={phase === "approving"}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {phase === "approving" ? <Loader2 size={18} className="animate-spin" /> : <HardDrive size={18} />}
              {me ? t("Join as {name}", { name: me.displayName }) : t("Approve with aindrive")}
            </button>
            {!me && <p className="mt-2 text-[11px] text-neutral-400">{t("When aindrive opens, just tap [Approve].")}</p>}
            {me && (
              <button
                data-testid="family-invite-other-account"
                onClick={() => void fetch("/api/auth/logout", { method: "POST" }).then(() => setMe(null))}
                className="mt-2 text-[11px] text-neutral-400 underline underline-offset-2"
              >
                {t("Not {name}? Approve with another aindrive account", { name: me.displayName })}
              </button>
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
            <ul className="space-y-2">
              {cats.map((c) => (
                <li key={c.key}>
                  <button
                    data-testid={`family-cat-${c.key}`}
                    data-on={on.has(c.key) ? "true" : "false"}
                    onClick={() => toggle(c.key)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      on.has(c.key) ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800" : "border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <span className="text-2xl">{c.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-100">{t(c.label)}</span>
                      <span className="block truncate text-[11px] text-neutral-500">{c.folders.map((f) => f.root).join(", ")}</span>
                    </span>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${on.has(c.key) ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300"}`}
                    >
                      {on.has(c.key) && <Check size={14} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              data-testid="family-invite-share"
              onClick={() => void share()}
              disabled={phase === "sharing"}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {phase === "sharing" && <Loader2 size={18} className="animate-spin" />}
              {t("Share and start")}
            </button>
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
            <button
              onClick={() => router.push("/")}
              className="mt-6 w-full rounded-xl border border-neutral-200 py-3 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
            >
              {t("Go to the family space")}
            </button>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
