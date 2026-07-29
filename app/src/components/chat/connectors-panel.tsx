"use client";

import { useEffect, useState } from "react";
import { X, MessageCircle, Users, HardDrive } from "lucide-react";

type Provider = "slack" | "teams" | "drive";

interface ConnectorState {
  provider: Provider;
  status: "connected" | "disconnected";
  accountLabel: string | null;
  connectedAt: string | null;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  slack: "Slack",
  teams: "Teams",
  drive: "Google Drive",
};

const PROVIDER_ICON: Record<Provider, React.ComponentType<{ size?: number }>> = {
  slack: MessageCircle,
  teams: Users,
  drive: HardDrive,
};

/** Connector settings panel (mock): Slack/Teams/Drive states reproduced in-app only. */
export function ConnectorsPanel({ onClose }: { onClose: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorState[] | null>(null);
  const [busy, setBusy] = useState<Provider | null>(null);

  async function load() {
    const res = await fetch("/api/ai/connectors");
    if (!res.ok) return;
    const data = await res.json();
    setConnectors(data.connectors);
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect(provider: Provider) {
    setBusy(provider);
    try {
      await fetch(`/api/ai/connectors/${provider}`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: Provider) {
    setBusy(provider);
    try {
      await fetch(`/api/ai/connectors/${provider}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function reauth(provider: Provider) {
    setBusy(provider);
    try {
      await fetch(`/api/ai/connectors/${provider}`, { method: "DELETE" });
      await fetch(`/api/ai/connectors/${provider}`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="connectors-panel"
      className="absolute right-4 top-12 z-20 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-[#252525]"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Connectors</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-2">
        {(connectors ?? []).map((c) => {
          const Icon = PROVIDER_ICON[c.provider];
          const connected = c.status === "connected";
          return (
            <div
              key={c.provider}
              data-testid={`connector-${c.provider}`}
              className="flex flex-col gap-1 rounded-md border border-neutral-100 px-2 py-2 dark:border-neutral-700"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                  <Icon size={15} />
                  {PROVIDER_LABEL[c.provider]}
                </div>
                <span
                  data-testid={`connector-status-${c.provider}`}
                  className={`text-xs ${
                    connected
                      ? "text-green-600 dark:text-green-400"
                      : "text-neutral-400 dark:text-neutral-500"
                  }`}
                >
                  {c.status}
                </span>
              </div>
              {connected && c.accountLabel && (
                <p
                  data-testid={`connector-account-${c.provider}`}
                  className="truncate text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {c.accountLabel}
                </p>
              )}
              <div className="flex gap-1.5">
                {connected ? (
                  <>
                    <button
                      type="button"
                      data-testid={`connector-disconnect-${c.provider}`}
                      disabled={busy === c.provider}
                      onClick={() => void disconnect(c.provider)}
                      className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    >
                      Disconnect
                    </button>
                    <button
                      type="button"
                      data-testid={`connector-reauth-${c.provider}`}
                      disabled={busy === c.provider}
                      onClick={() => void reauth(c.provider)}
                      className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    >
                      Reauthenticate
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid={`connector-connect-${c.provider}`}
                    disabled={busy === c.provider}
                    onClick={() => void connect(c.provider)}
                    className="rounded bg-neutral-800 px-2 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
