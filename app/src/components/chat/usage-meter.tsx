"use client";

export interface UsageState {
  plan: string;
  messageCount: number;
  monthlyLimit: number;
  remaining: number;
  aiDisabledByAdmin: boolean;
}

/** Usage readout above the composer + at-limit / admin-disabled banners (plan-gating mock). */
export function UsageMeter({ usage, onUpgrade }: { usage: UsageState; onUpgrade: () => void }) {
  const limitReached = usage.plan === "free" && usage.messageCount >= usage.monthlyLimit;

  return (
    <div className="mb-2 space-y-2">
      <div
        data-testid="chat-usage-meter"
        className="text-xs text-neutral-400 dark:text-neutral-500"
      >
        {usage.messageCount} / {usage.monthlyLimit}
      </div>
      {usage.aiDisabledByAdmin && (
        <div
          data-testid="chat-ai-disabled"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
        >
          An administrator has disabled AI for this workspace.
        </div>
      )}
      {!usage.aiDisabledByAdmin && limitReached && (
        <div
          data-testid="chat-upgrade-banner"
          className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
        >
          <span>You&rsquo;ve hit this month&rsquo;s free usage limit.</span>
          <button
            type="button"
            data-testid="chat-upgrade-btn"
            onClick={onUpgrade}
            className="shrink-0 rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700"
          >
            Upgrade
          </button>
        </div>
      )}
    </div>
  );
}
