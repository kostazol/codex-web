# Desktop dictation in the browser

Updated for Desktop 26.1021.31345 on 2026-10-25.

The microphone button runs Desktop's original recording UI inside the composer:
waveform, cancellation, confirmation, transcription progress, errors and retry.
Confirming dictation inserts its transcript into the draft using Desktop's native
callback. The browser uses the microphone of the phone or computer on which the
page is open. The former recording/file-picker dialog has been removed.

## Access and lifetime

Recording requires a trusted HTTPS origin or localhost, the browser's microphone
permission, and Desktop's normal account/workspace availability checks. On LAN
HTTP, the browser cannot provide microphone capture. There is no file-upload
fallback and no insecure-origin or account-gate bypass.

The bundled `CKs` hook, `Z0a` capture owner, device selection and `dmo`
authenticated transcription remain unchanged from the pinned Desktop archive.
The Electron-only capture API is absent from the browser preload, so upstream
uses `getUserMedia` and `MediaRecorder`. A saved Desktop microphone device ID
falls back to an available browser microphone when that device is unavailable.

Native code owns track release, pending-permission cancellation, recorder state,
transcription, error handling and the recording time limit (595 seconds in this
release). No audio file picker, download control, custom transcription endpoint
or separate dialog is installed by this fork. Existing Desktop transcription
sends audio through the authenticated OpenAI transport; this change does not add
recordings to the PWA asset cache or persist them on the local server.

## Upgrade contract

`patches/series.json` contains no dictation override. Neither platform applies the
former `webview-dictation.patch`, and the preload exposes no `openDictation` hook.
Preserve this boundary when upgrading: inspect upstream browser support before
adding any compatibility adapter. Do not copy minified symbol names across
releases without reviewing the changed source.

## Validation

- Both platform patch series replay cleanly: 25 patches, 10 files, no offsets or
  fuzz. The native recording hook is byte-identical to each untouched baseline.
- Six tests run the shipped availability/device/capture code with a fake
  microphone. They cover native gates, cancellation and ownership release,
  unavailable Desktop devices, permission denial and late permission resolution.
- Physical phone capture and speech recognition require device acceptance; fake
  media tests do not establish microphone quality or transcription accuracy.

See [upgrade checks](../UPGRADING.md#browser-dictation). Browser UI and regression
results for this change are recorded after deployment below.

## Deployed verification

- The published Windows assets match all 10 files from the clean 25-patch replay;
  the generated preload contains no custom dictation hook.
- The full Node suite passed: 70 tests, zero failures/skips. All six native
  dictation tests also passed against the macOS replay with its clean baseline.
- HTTPS at `web-codex.duckdns.org` served PWA release
  `6297922addf24d9223cc419b`. A fresh browser document adopted that release with
  its cache ready. Both HTTP and HTTPS bridge resume/integrity probes passed.
- At 360x800, Dictate entered the original inline pending-permission state, with
  no upload dialog. Cancel restored Dictate and the empty draft; a second start
  and cancel also worked. The in-app browser did not grant microphone access, so
  waveform rendering during capture and live speech recognition were not tested
  there. No ambient audio was transcribed or chat message sent.
