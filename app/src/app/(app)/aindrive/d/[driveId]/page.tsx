"use client";

import { use } from "react";
import { AinuiText } from "@/components/ainui/surface";
import { Browser } from "@/components/home/aindrive-panel";
import { AindriveAccountBadge, AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { useT } from "@/i18n/provider";
import { aindriveRawUrl } from "@/lib/aindrive-url";

/** One drive of the person's own aindrive account, whole: every folder and
 *  file, opened and edited in place (sidebar → aindrive). */
export default function AindriveDrivePage({ params }: { params: Promise<{ driveId: string }> }) {
  const { driveId } = use(params);
  const t = useT();
  const info = useAindriveInfo();
  if (!info) return null;
  if (!info.connected)
    return (
      <div className="mx-auto max-w-xl px-8 pt-16">
        <AindriveConnect />
      </div>
    );
  const drive = info.drives.find((d) => d.id === driveId);
  const offline = drive?.online === false;
  return (
    <div data-testid="aindrive-drive-page" className="mx-auto max-w-5xl px-8 pb-16 pt-12">
      <div className="mb-1">
        <AindriveAccountBadge />
      </div>
      <AinuiText text={drive?.name ?? driveId} />
      <AinuiText text={offline ? t("Offline — opens once aindrive is running on the computer that holds this drive's folder.") : t("Online — the files live on that computer; what you view and edit here changes them there.")} />
      {!offline && (
        <Browser
          key={driveId}
          api={`/api/aindrive/drives/${driveId}`}
          title={drive?.name ?? driveId}
          rawUrl={(path) => aindriveRawUrl({ driveId, path })}
        />
      )}
    </div>
  );
}
