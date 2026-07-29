"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/invite/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (d?.workspaceName) setWorkspaceName(d.workspaceName);
        else setInvalid(true);
      })
      .catch(() => alive && setInvalid(true));
    return () => {
      alive = false;
    };
  }, [token]);

  async function accept() {
    setJoining(true);
    const res = await fetch(`/api/invite/${token}`, { method: "POST" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setInvalid(true);
      setJoining(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
        {invalid ? (
          <p className="text-sm text-neutral-500">
            This invite link is invalid or has expired.
          </p>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Join {workspaceName ?? "workspace"}
            </h1>
            <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
              You&apos;ve been invited to collaborate.
            </p>
            <button
              data-testid="join-accept"
              disabled={joining}
              onClick={accept}
              className="w-full rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
            >
              {joining ? "Joining…" : "Accept invite"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
