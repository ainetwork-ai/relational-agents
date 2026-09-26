import type { A2uiAction, A2uiMessage } from "ain-ui";

/** Remember the folder actually returned by the producer, including write/delete navigation. */
export function folderRefreshAction(messages: A2uiMessage[]): A2uiAction | null {
  for (const message of [...messages].reverse()) {
    if (!("updateDataModel" in message) || !message.updateDataModel.value) continue;
    const value = message.updateDataModel.value as Record<string, unknown>;
    if (!Array.isArray(value.items) || typeof value.path !== "string" || typeof value.drive_id !== "string") continue;
    return {
      name: typeof value.query === "string" && value.query ? "aindrive.search" : "aindrive.view",
      context: { drive_id: value.drive_id, path: value.path, value: value.view, query: value.query },
    };
  }
  return null;
}
