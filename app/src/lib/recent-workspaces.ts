/** Per-device workspace visit log (localStorage) — powers Home's
 *  "Recently visited" workspace section. Recorded wherever a workspace is
 *  entered: Home cards and the sidebar switcher. */

const KEY = "recent-workspaces";
const MAX = 8;

export function recordWorkspaceVisit(id: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).filter(
      (x) => x !== id
    );
    list.unshift(id);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage unavailable (private mode) — recents just stay empty
  }
}

export function listRecentWorkspaces(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
