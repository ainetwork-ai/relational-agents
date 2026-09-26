"use client";
import { useEffect, useRef, useState } from "react";
import { AinuiFolderChat } from "ain-ui/react";
import { readChatStream, type FolderChatAgent } from "ain-ui";
import "ain-ui/styles.css";

export function DriveFolderChat({ source, path }: { source: string; path: string }) {
  return <ScopedChat key={`${source}:${path}`} source={source} path={path} />;
}
function ScopedChat({ source, path }: { source: string; path: string }) {
  const [agents, setAgents] = useState<FolderChatAgent[]>([]);
  const [error, setError] = useState("");
  const approved = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/ainui/folder-chat?${new URLSearchParams({ source, path })}`, { signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Folder chat unavailable");
      if (!controller.signal.aborted) setAgents(data.agents);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [source, path]);
  return <details className="mt-4 rounded-lg border p-3"><summary>Folder chat</summary>
    {error && <p role="alert" className="text-sm text-neutral-500">{error}</p>}
    {agents.length > 0 && <AinuiFolderChat driveId={source} path={path} agents={agents} onSend={async turn => {
      if (!approved.current.has(turn.agentId)) {
        if (!window.confirm("Send this folder's file list and temporary file links to the selected remote agent?")) throw new Error("Remote agent access was not approved");
        approved.current.add(turn.agentId);
      }
      const response = await fetch("/api/ainui/folder-chat", { method: "POST", signal: turn.signal, headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ source, path, q: turn.q, agentId: turn.agentId, contextId: turn.contextId }) });
      return readChatStream(response, turn.onUpdate, turn.signal);
    }} />}
  </details>;
}
