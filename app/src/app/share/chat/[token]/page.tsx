"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MarkdownContent } from "@/app/(app)/chat/[chatId]/markdown";

type SharedMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: { id: string; title: string }[];
  createdAt: string;
};

type SharedChat = {
  chat: { title: string; icon: string | null };
  messages: SharedMessage[];
};

export default function SharedChatPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<SharedChat | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/shared/${token}`)
      .then((r) => {
        if (r.status === 404) {
          if (alive) setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((json) => {
        if (alive && json) setData(json);
      })
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white dark:bg-[#191919]">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  if (notFound || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white dark:bg-[#191919]">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Shared chat not found
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white pb-24 dark:bg-[#191919]">
      <div className="mx-auto max-w-[708px] px-6 pt-12">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {data.chat.icon ? `${data.chat.icon} ` : ""}
            {data.chat.title || "Untitled chat"}
          </h1>
          <span
            data-testid="chat-readonly-badge"
            className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            Read-only share
          </span>
        </div>

        <div data-testid="chat-messages" className="mt-6 space-y-4">
          {data.messages.map((m, idx) => (
            <div
              key={idx}
              data-role={m.role}
              data-testid={m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  m.role === "user"
                    ? "bg-blue-50 text-neutral-900 dark:bg-blue-900/30 dark:text-neutral-100"
                    : "bg-neutral-50 dark:bg-neutral-800/60"
                }`}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
                    {m.content}
                  </p>
                ) : (
                  <>
                    <div data-testid="chat-msg-content">
                      <MarkdownContent content={m.content} />
                    </div>
                    {m.sources && m.sources.length > 0 && (
                      <div
                        data-testid="chat-sources"
                        className="mt-2 space-y-0.5 text-xs text-neutral-400 dark:text-neutral-500"
                      >
                        <p>Sources</p>
                        <ul className="space-y-0.5">
                          {m.sources.map((s, sIdx) => (
                            <li key={s.id}>
                              <a
                                data-testid={`chat-source-${sIdx}`}
                                href={`/p/${s.id}`}
                                className="truncate text-blue-500 hover:underline dark:text-blue-400"
                              >
                                {s.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
