// Remounts on every navigation, replaying the enter animation so page
// switches fade in instead of hard-swapping.
export default function Template({ children }: { children: React.ReactNode }) {
  // h-full so a page can fill the viewport and scroll its own inner region
  // (the DM transcript). Without a definite height here, h-full inside resolves
  // to auto, the page grows past <main>, and pinned furniture scrolls away.
  return <div className="page-enter h-full">{children}</div>;
}
