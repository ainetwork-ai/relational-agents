# AIN-UI folder chat

`app/src/components/ainui/drive-browser.tsx` opens `folder-chat.tsx` for the
currently displayed folder. The renderer is `AinuiFolderChat` from the published
`ain-ui@0.2.0` package. Picker mode omits chat. Changing folder remounts the chat,
cancels its request, and clears its agent contexts.

`GET/POST /api/ainui/folder-chat` resolves the browser's source to a server-owned
Aindrive link, confines the path to that link, and uses the current user's
connected Aindrive account. For a shared link, only its creator may export folder
context to a remote agent. A shared-folder reader cannot use its owner's token
to export files. The browser never receives account or MCP credentials.

The relay preserves the upstream streaming body. Aindrive emits AG-UI SSE:
`RUN_STARTED`, `CUSTOM` (`ainui.chat.snapshot`), AIN-UI `ACTIVITY_SNAPSHOT`, then
`RUN_FINISHED` or `RUN_ERROR`. The package reads snapshots without appending the
final answer twice. A disconnected stream is an error, never an automatic resend.

Aindrive's owner-only `/api/drives/:id/folder-chat` exposes aindrive-cloud and
optional `AINDRIVE_FOLDER_AGENTS` entries (`id`, `label`, `card`). The device must
be online. It recursively lists the selected subtree, marks limits/read errors,
and provides bounded temporary file links and MCP grants. The receiving model
decides which granted files to read. AIN-UI protocol and receiver contract:
[AIN-UI](https://github.com/ainetwork-ai/AIN-UI),
[Aindrive handoff](https://github.com/ainetwork-ai/aindrive/blob/main/mobile/docs/folder-agent-handoff.md).

Validation: TypeScript, `app/scripts/ainui-boundary-selftest.ts`, package
stream/renderer tests, and Aindrive's authenticated folder-chat route tests.
A local simulated-agent browser fixture verifies progressive text, Stop, and
folder reset; it does not establish production or native-device delivery.
