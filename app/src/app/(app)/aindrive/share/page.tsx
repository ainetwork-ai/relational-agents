"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AindriveShare } from "@/components/aindrive/aindrive-share";

/** The step after "aindrive로 로그인" (and sidebar → aindrive → 팀과 공유):
 *  pick which of your aindrive folders the team sees, then go on. */
export default function AindriveSharePage() {
  return (
    <Suspense>
      <SharePage />
    </Suspense>
  );
}

function SharePage() {
  const params = useSearchParams();
  const raw = params.get("next") ?? "/";
  // only a path on this site — never an open redirect
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return (
    <div className="px-8 pb-16 pt-16">
      <AindriveShare
        onDone={async ({ workspaceId }) => {
          // land in the workspace the folders were shared into
          if (workspaceId)
            await fetch("/api/workspaces/switch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ workspaceId }),
            }).catch(() => {});
          window.location.href = next;
        }}
      />
    </div>
  );
}
