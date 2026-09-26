import type { A2uiAction, A2uiMessage } from "ain-ui";

export function confinedPath(root: string, value: unknown): string {
  if (typeof value !== "string") throw new Error("path required");
  const parts = value.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.includes("..") || /[\x00-\x1f]/.test(value)) throw new Error("Invalid path");
  const path = parts.join("/");
  if (root && path !== root && !path.startsWith(`${root}/`)) throw new Error("Path is outside the linked folder");
  return path;
}

export function confineAction(action: A2uiAction, link: { driveId: string; root: string }, protectedPath?: string): A2uiAction {
  const allowed = ["aindrive.open", "aindrive.search", "aindrive.view", "aindrive.edit", "aindrive.new_file", "aindrive.save", "aindrive.delete", "aindrive.upload"];
  if (!allowed.includes(action.name)) throw new Error("Unsupported AIN-UI action");
  const c = action.context ?? {};
  if (c.drive_id !== undefined && c.drive_id !== link.driveId) throw new Error("Drive is outside the linked folder");
  const path = confinedPath(link.root, c.path);
  if (action.name === "aindrive.delete" && path === link.root) throw new Error("Cannot delete the linked root");
  const write = ["aindrive.edit", "aindrive.new_file", "aindrive.save", "aindrive.delete", "aindrive.upload"].includes(action.name);
  const insideProtected = protectedPath && (path === protectedPath || path.startsWith(`${protectedPath}/`));
  const deletesProtectedParent = protectedPath && action.name === "aindrive.delete" && (!path || protectedPath.startsWith(`${path}/`));
  if (write && (insideProtected || deletesProtectedParent)) throw new Error("Backed-up pages are read-only here");
  if (["aindrive.upload", "aindrive.new_file"].includes(action.name)) {
    if (typeof c.name !== "string" || /[/\\\x00-\x1f]/.test(c.name) || c.name === "." || c.name === "..") throw new Error("Invalid file name");
    const target = path ? `${path}/${c.name}` : c.name;
    if (protectedPath && (target === protectedPath || target.startsWith(`${protectedPath}/`))) throw new Error("Backed-up pages are read-only here");
  }
  return { ...action, context: { ...c, drive_id: link.driveId, path } };
}

/** Hide navigation above a linked root; the action boundary remains authoritative. */
export function confineSurface(messages: A2uiMessage[], root: string, readOnly = false): A2uiMessage[] {
  return messages.map((m) => {
    if (readOnly && "updateComponents" in m) return { ...m, updateComponents: { ...m.updateComponents,
      components: m.updateComponents.components.map((c) => {
        const action = c.action as { event?: { name?: string } } | undefined;
        return c.component === "FileUpload" || (action?.event?.name && !["aindrive.open", "aindrive.search", "aindrive.view"].includes(action.event.name))
          ? { id: c.id, component: "Text", text: "" } : c;
      }),
    } };
    if (!("updateDataModel" in m) || !m.updateDataModel.value || typeof m.updateDataModel.value !== "object") return m;
    const data = { ...m.updateDataModel.value } as Record<string, unknown>;
    if (Array.isArray(data.crumbs)) data.crumbs = data.crumbs.filter((c: { path?: string }) => !root || c.path === root || c.path?.startsWith(`${root}/`));
    if (root && typeof data.parent === "string" && data.parent !== root && !data.parent.startsWith(`${root}/`)) data.parent = root;
    return { ...m, updateDataModel: { ...m.updateDataModel, value: data } };
  });
}
