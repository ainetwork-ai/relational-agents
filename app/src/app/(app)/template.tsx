// Remounts on every navigation, replaying the enter animation so page
// switches fade in instead of hard-swapping.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
