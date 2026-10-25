# OpenChamber mobile chat reference

Reviewed 2026-10-26 at public commit
[`9fe0a46fb2fc6ef856cb0ca316ac12c179789922`](https://github.com/openchamber/openchamber/tree/9fe0a46fb2fc6ef856cb0ca316ac12c179789922).
This is a design/source comparison, not a second chat backend or a copied mobile app.

## Useful patterns and our adaptation

| OpenChamber mechanism | Codex Web implementation |
| --- | --- |
| Compact pill while reading, full editor while composing | The same native editor occupies a compact row when blurred and expands in place on focus. |
| Primary attachment, microphone and Send/Stop actions separate from model/agent controls | Native attachments and recording/send controls share the compact row; permissions and the model use a second row with visible labels. |
| Dictation lifetime independent of collapsed/expanded UI | Keep the upstream recording hook and native recording layout; CSS never reparents or remounts its controls. |
| Keyboard-aware viewport and safe-area insets | Existing visualViewport sizing and safe-area rules remain authoritative. Expanded text is capped against visible viewport height. |
| Mobile Return inserts a newline | The native editor patch now uses the same 1024px breakpoint as the mobile layout. Explicit Send and modified keyboard shortcuts retain native handling. |
| Preserve reading position and scroll only the transcript | Keep Codex's native virtualized timeline and scroll ownership; no competing scroll controller or second message cache. |

Sources inspected:

- [MobilePillComposer](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/chat/composer/ui/MobilePillComposer.tsx)
- [ComposerFooter](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx)
- [useMobileComposerShell](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/chat/composer/state/useMobileComposerShell.ts)
- [ComposerDictation](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/dictation/ComposerDictation.tsx)
- [keyboardPolicy](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/chat/composer/keyboardPolicy.ts)
- [ChatContainer](https://github.com/openchamber/openchamber/blob/9fe0a46fb2fc6ef856cb0ca316ac12c179789922/packages/ui/src/components/chat/ChatContainer.tsx)

## Ownership and upgrades

`webview-mobile-composer.patch` adds stable slot attributes to the pinned upstream
composer and preserves text in its model picker on mobile. It does not add an editor,
React state, model store, audio recorder or backend. `assets/mobile-composer.css`
is bundled with the existing browser mobile controller, and scopes the layout to
the tagged adaptive composer below 1025px. Native dictation and expanded document
layouts retain their upstream controls. The model/permission selectors still call
the original handlers and respect the original account/workspace policy.

Do not copy OpenChamber's Capacitor/native keyboard timings or global overflow
overrides into this PWA. Keep touch targets at least 44px even where the reference
uses smaller icons. No OpenChamber implementation code is vendored.

On a Desktop upgrade, review the adaptive leading/input/trailing/actions slots,
model picker's hideLabel property and native Enter handler. Replay both platform
series with zero offsets/fuzz. Browser verification must cover 320px, 360px,
412px, landscape, reduced-height keyboard viewport and a desktop width; check
actual overlap, draft retention, menu dismissal and recording separately.

## Verification on 2026-10-26

- Windows and macOS: 27 patches, 10 files, zero offsets/fuzz. All 10 published
  Windows source files match the clean replay. No edits are maintained only in
  extracted bundles.
- Full Windows test run: 78 passed, zero failures/skips. Focused macOS patch
  tests: 22 passed. Type checks pass for the new layout and device adapters.
- UI checked at 320x720, 360x430, 360x800, 412x915, 800x360, 1024x768 and
  1280x900. Composer buttons stay on screen, do not overlap, and mobile targets
  remain at least 44x44px. Desktop retains its native layout.
- Two-line draft entry inserts a newline without submission. Starting/cancelling
  dictation and opening permissions/model menus preserves the draft. The microphone
  bounds remain identical before and after pressing it from the expanded editor.
- The model sheet fits in 360x430; Close dismisses it without selecting a model.
  Chats opens and closes through the same navigation control.
- HTTP and HTTPS bridge resume and PWA release integrity probes pass. Final
  published release: `77f0f73ed789c3a5c8eccb67`.
- The user confirmed microphone startup and the separate Send arrow on Samsung
  before the composer layout change. The final layout's physical keyboard,
  touch gestures and full transcription still require a Samsung acceptance pass.

The temporary Vite preview was stopped after its proxy failed to initialize the
native bridge reliably. Browser validation above used the actual HTTPS service.
An unelevated full test attempt could not run GNU patch/Electron; the recorded
78/78 result is the host-enabled run, not those failed setup attempts.
