/**
 * "@<folder>" in a room's chat: the folders the room's agent may read can be
 * mentioned by handle, next to the agent ("@agent @Mom's-phone what's in here?").
 * The handle is the folder's label with whitespace as dashes, so it survives
 * as one word in plain text. Shared by the @ menu (client) and the agent
 * (server), which narrows what it reads to the mentioned folders.
 */
export function folderHandle(label: string): string {
  return label.trim().replace(/\s+/g, "-");
}

/** The handles in `handles` that `text` mentions — "@handle" at a word start,
 *  ending at whitespace, punctuation or the text end (a Korean particle may
 *  follow it directly). Longest handle first, so "@photos-2024" is not "@photos". */
export function mentionedFolders(text: string, handles: readonly string[]): string[] {
  const t = text.toLowerCase();
  const known = [...new Set(handles.filter(Boolean))].sort((a, b) => b.length - a.length);
  const hit: string[] = [];
  for (let i = t.indexOf("@"); i !== -1; i = t.indexOf("@", i + 1)) {
    if (i > 0 && !/\s/.test(t[i - 1])) continue;
    const rest = t.slice(i + 1);
    const h = known.find((k) => rest.startsWith(k.toLowerCase()) && !/[A-Za-z0-9_\-]/.test(rest[k.length] ?? ""));
    if (h && !hit.includes(h)) hit.push(h);
  }
  return hit;
}
