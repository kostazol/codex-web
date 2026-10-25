# Browser file attachments

Desktop 26.1021.31345 uses `AppHost.fileAttachments.pickFiles` from its
`use-file-picker` hook. Intercepting only the older `vscode://codex/pick-files`
fetch message leaves this path pointing at the server PC's Electron dialog.
The headless server cannot display that dialog; the composer then reports
`Unable to open file picker`.

The existing AppHost installation patch delegates to `adaptBrowserAppHost` in
the preload. That adapter replaces only `fileAttachments.pickFiles` with
`pickBrowserFiles`. All other attachment services, including SSH transfer and
image persistence, retain their original implementation. The legacy IPC single
and multiple file entry points use the same browser picker.

## Device and data boundary

1. The user's tap opens a temporary browser file input synchronously, before
   any network request or asynchronous service lookup. This preserves the
   [user activation required by showPicker](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker).
   Browsers without `showPicker` use the standard input click.
2. Single/multiple selection, image-only selection and extension filters map to
   browser input attributes. The chooser belongs to the device running the page,
   including installed Chrome PWAs. Cancellation resolves to an empty selection;
   the input and its listeners are removed on completion or failure.
3. Only selected files are posted as multipart data to the existing same-origin
   `/__backend/upload` endpoint. It stores them as temporary files on the Codex
   Web server and returns `{ label, path, fsPath }` descriptors. Failed uploads
   remain errors rather than being presented as successful attachments.
4. The native composer consumes those descriptors and owns previews, attachment
   removal and sending. Choosing a file does not send a chat message. Uploaded
   user files are excluded from the PWA asset cache.

When an upstream caller explicitly requests a directory, the browser may offer
directory contents through `webkitdirectory`. This does not mount a phone folder
or recreate its directory structure on the server. The regular mobile composer
uses file selection. Browser/Android controls determine which file providers
and directory features are available.

## Upgrade and verification

No new minified bundle patch is required: this uses the existing AppHost hook in
`webview-browser-audio-host.patch`. Rebuild the preload and publish its matching
immutable PWA release. Existing open windows keep the previous release until
closed normally; do not force reload an in-progress draft.

For a new Desktop archive, inspect `use-file-picker-*.js`, the native composer
caller and the `fileAttachments` service contract. Run:

```powershell
$env:CODEX_WEB_ASAR_DIR = 'scratch-candidate/asar'
node --test tests/file-picker.test.cjs
```

Tests exercise the shipped native hook with the browser adapter, synchronous
opening, cancellation/reselection, upload errors, descriptor validation, retained
remote services and legacy IPC envelopes. They do not emulate an Android system
file provider. Also verify through the real HTTPS UI: select a harmless text file
and image, confirm they appear in the composer, remove those test attachments,
then check the installed Samsung PWA separately.

Validated on the Windows deployment on 2026-10-26: 87 Node tests passed with the
full prepared Desktop tree, including all 9 attachment checks; the two adapter
modules passed TypeScript checking. The real HTTPS composer at 360 x 800 opened
the browser file chooser and displayed a text file and PNG together. Those test
attachments were removed without sending a message. HTTP/HTTPS release integrity
and WebSocket reconnect probes also passed. This is not a physical Samsung or
macOS runtime acceptance result; the stored macOS patch baseline contains only
patch target files and cannot supply the separate native picker chunk test.
