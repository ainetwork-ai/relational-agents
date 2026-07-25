/** Page-load skeleton (UIUX #10): title + block bars while /p/[id] streams. */
export default function Loading() {
  return (
    <div data-testid="page-skeleton" className="mx-auto max-w-[708px] px-16 pt-24">
      <div className="h-10 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      <div className="mt-6 space-y-3">
        {[80, 95, 60, 90, 40].map((w, i) => (
          <div
            key={i}
            style={{ width: `${w}%` }}
            className="h-4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800"
          />
        ))}
      </div>
    </div>
  );
}
