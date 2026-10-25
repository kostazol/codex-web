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
The browser AppHost adapter omits the server PC's native audio/permission services,
so upstream uses `getUserMedia` and `MediaRecorder`. A saved Desktop microphone device ID
falls back to an available browser microphone when that device is unavailable.

Native code owns track release, pending-permission cancellation, recorder state,
transcription, error handling and the recording time limit (595 seconds in this
release). No audio file picker, download control, custom transcription endpoint
or separate dialog is installed by this fork. Existing Desktop transcription
sends audio through the authenticated OpenAI transport; this change does not add
recordings to the PWA asset cache or persist them on the local server.

## Upgrade contract

`webview-browser-audio-host.patch` adapts the AppHost at installation. It omits
`realtimeVoice`, `realtimeVoiceRuntime`, `microphoneCapture`, `systemPermissions`
and `dictationAudio`; unrelated services and `dictationStreaming` remain native.
The browser disables realtime voice UI gate `2380644311`, leaving the Send arrow
and normal dictation/account policy intact. Neither platform applies the
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

### 2026-10-26 correction

The first verification below did not cover a populated remote AppHost. It was
incorrect to interpret the spinner as a pending browser permission: Desktop's
`realtimeVoice.acquireMicrophone` stalled before `getUserMedia`, and its capability
also exposed the unsupported voice-chat Send replacement. The new adapter fixes
that device boundary without changing native `CKs` recording logic.

- Both 26-patch platform series replay with zero offsets/fuzz.
- 74 tests pass with no skips, including a remote host whose audio RPCs never
  resolve: browser capture now starts without invoking any of those RPCs.
- HTTPS release `f854cfed451a890c1ec53bc3` adopted in the verification browser.
  The trace now reaches `permission_requested`, `permission_ready` and
  `device_requested`; cancel restores the microphone and separate Send button.
  The embedded browser does not complete microphone acquisition, so physical
  Samsung capture/transcription is still a device acceptance check.
- HTTP/HTTPS bridge resume and immutable PWA integrity probes pass.

### Earlier verification (superseded for microphone startup)

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
