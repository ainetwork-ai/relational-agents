"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Star, FileText } from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useRecentsStore } from "@/stores/recents";
import { PageIcon } from "@/components/page-icon";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Card({ p, testid }: { p: Page; testid: string }) {
  return (
    <Link
      data-testid={testid}
      href={`/p/${p.id}`}
      className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <span className="shrink-0 text-base">
        <PageIcon icon={p.icon} fallback={<FileText size={16} className="text-neutral-400" />} />
      </span>
      <span className="truncate">{p.title || "Untitled"}</span>
    </Link>
  );
}

function Section({
  icon,
  title,
  items,
  prefix,
}: {
  icon: React.ReactNode;
  title: string;
  items: Page[];
  prefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {icon} {title}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((p) => (
          <Card key={p.id} p={p} testid={`${prefix}-${p.id}`} />
        ))}
      </div>
    </section>
  );
}

/** Home dashboard (Notion): greeting + recently visited + recently edited +
 *  favorites, each linking straight into the page. */
export default function HomePage() {
  const pages = usePagesStore((s) => s.pages);
  const load = usePagesStore((s) => s.load);
  const recentIds = useRecentsStore((s) => s.ids);
  const [now] = useState(() => new Date());

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => Object.values(pages).filter((p) => !p.isArchived), [pages]);
  const favorites = all.filter((p) => p.isFavorite).slice(0, 8);
  // OKF file nodes carry a FABRICATED updatedAt (fetch time) — only Postgres
  // pages have a real edit timestamp, so only they qualify here
  const edited = useMemo(
    () =>
      [...all]
        .filter((p) => p.updatedAt && UUID_RE.test(p.id))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 8),
    [all]
  );
  const visited = recentIds.map((id) => pages[id]).filter(Boolean).slice(0, 8) as Page[];

  const hour = now.getHours();
  const greeting =
    hour < 6 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div data-testid="home-dashboard" className="mx-auto max-w-4xl px-8 py-12">
      <h1 className="mb-8 text-2xl font-bold text-neutral-900 dark:text-neutral-100">{greeting}</h1>
      <Section icon={<Clock size={12} />} title="Recently visited" items={visited} prefix="home-visited" />
      <Section icon={<FileText size={12} />} title="Recently edited" items={edited} prefix="home-edited" />
      <Section icon={<Star size={12} />} title="Favorites" items={favorites} prefix="home-fav" />
    </div>
  );
}
