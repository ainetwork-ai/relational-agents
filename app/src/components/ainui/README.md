# AIN-UI in ainmem

All aindrive file and account surfaces use `ain-ui/react`, backed by the official
A2UI processor and the AIN-UI catalog. Host layout and navigation remain Next.js.

- `surface.tsx`: shared renderer, app-owned buttons/forms/text, file views and
  access-checked asset URLs. `renderFile` connects AIN-UI `FileView` to the existing
  lazy document/media renderers, including spreadsheet and Office previews.
- `drive-browser.tsx`: producer-owned messages from `/api/ainui/aindrive`.
  File selection uses the same surface in read-only mode, returning a reference
  to the chosen file. It never copies bytes or invokes file mutations.
- `gift-sale.tsx`: displays the payment surface returned by aindrive through the
  authenticated gift wallet route. Only an explicit pay action opens the wallet;
  a server-confirmed settlement unlocks the gift.

Consumers include the drive pages, sidebar, account connection/sharing, backup
and family-folder management, editor attachments/albums/gifts, and file picker.
App-owned forms use standard A2UI TextField/ChoicePicker bindings and send current
values in an action. The surrounding fieldset and in-flight guard block duplicate
submissions. Browser actions never substitute for server authorization.

File operations go through `lib/ainui-boundary.ts`: linked root/drive confinement,
backup protection and linked-root deletion prevention. Picker surfaces omit write
controls and their route rejects write actions. Uploads retain the package's
8 MiB decoded limit and the host's bounded request body.

Validation: start `scripts/dev.sh`, then run `node app/e2e/ainui.check.mjs` with
Node 22. It temporarily installs a fixture route, mocks all APIs in Playwright,
and removes the route afterward. It does not use a database or settle payments.
Also run the wallet-payment and ainui-boundary selftests under `app/scripts`.
