# Mobile upstream and patch boundary

Checked 2026-10-25. The official Android product is ChatGPT (`com.openai.chatgpt`,
publisher OpenAI), with Codex hosts accessed through Remote. This is not a
separately downloadable Codex Android application. Official references:

- [Remote connections](https://learn.chatgpt.com/docs/remote-connections)
- [Official Android distribution](https://play.google.com/store/apps/details?id=com.openai.chatgpt)

The reference interaction model is a paired host, its live projects/chats, chat
actions, approvals and a composer. Files and execution stay on the selected host.
This fork already uses the Desktop host's sessions through its browser bridge;
it does not implement or replace OpenAI's mobile pairing/relay protocol.

No Android package was obtained in this update. The official distribution page
offered installation through Google Play, not a standalone APK download; no
local APK or ADB installation was available. Android internals and screenshots
have **not** been reverse engineered or incorporated. The current mobile UI is
a tested browser adaptation of Desktop, not a copy of Android code.

## Independent mobile layer

- `assets/mobile.css`: layout, safe areas, touch targets and overlay panels.
- `src/browser/mobile.ts`: visual viewport and navigation backdrop/focus.
- `patches/webview-mobile.patch` and its Windows variant: explicit stable hook
  and viewport metadata. Applied after Desktop compatibility patches.
- `webview-prosemirror-inputmode.patch`: software keyboard and phone Return behavior
  through the editor's existing newline commands.

Desktop upgrades must replay both patch sets from clean formatted bundles and
check phone/tablet/desktop widths. Do not copy hashed CSS class names into the
mobile layer. Test opening an old chat, a new prompt, multiline drafts, drawers,
model/settings menus and panels. Physical Android/iOS keyboard testing remains
separate from browser viewport tests.

## When an official Android package is available

1. Obtain the installed package and any splits from the owner's device, or an
   official download. Keep them outside Git in `scratch-android/`.
2. Verify `com.openai.chatgpt`, version and publisher signing certificate using
   Android SDK `apkanalyzer`/`apksigner`; record SHA-256 for every split. An APK's
   filename or a mirror's label is not publisher verification.
3. Inventory without executing the application:

   ```powershell
   python scripts/inspect_android.py scratch-android/base.apk --output scratch-android/inventory.json
   ```

4. Inspect any HTML/JS/CSS candidates, entry points and native-bridge contracts.
   Presence of web assets alone does not prove they are the Remote/Codex UI.
   Native Android/Compose screens need an explicit web implementation; they cannot
   be substituted as an Electron HTML bundle.
5. Only after finding reusable Remote web assets, add a version/hash-pinned
   Android extraction target and `patches/android/<version>/`. Generate diffs
   from untouched assets, preserve native auth/approval boundaries and test bridge
   compatibility with the pinned Desktop version. Keep binaries out of the fork.

There is deliberately no fake Android download URL, placeholder package version,
or unverified Android patch set in the build.
