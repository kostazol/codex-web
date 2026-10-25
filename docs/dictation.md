# Browser dictation

Added for Desktop 26.1021.31345 on 2026-10-25.

The composer's Dictate button opens a touch-friendly dialog with recording,
audio-file selection, playback, download, cancellation and explicit transcription.
The transcript is inserted into the original composer draft, never sent as a chat
message. Existing draft text uses Desktop's native insertion behavior.

## HTTP and microphone access

On LAN HTTP (`http://192.168...`) browsers do not expose `getUserMedia`. Recording
is disabled with an explanation, while uploading an existing recorder file works.
On HTTPS with a trusted certificate, or localhost on the server PC, the Record
button requests microphone access only after the user presses it. No browser
security setting, certificate check or permission prompt is bypassed.

See [MDN's secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).
OpenAI distinguishes [dictation from a live voice conversation](https://developers.openai.com/training/walkthroughs/using-voice).
This change implements dictation, not a realtime voice conversation.

## Integration and lifetime

`webview-dictation.patch` in both platform series replaces only the hardware check
in the Codex dictation access policy when the browser dialog is installed. Native
account, workspace, inference-provider, configuration and rollout checks still
apply. It does not force access gates or modify credentials.

The patched `CKs` recording entry calls `src/browser/dictation.ts` after native
availability/busy checks. The dialog delegates to Desktop's `dmo` multipart
`/transcribe` implementation, using the current authenticated desktop transport.
It calls `onTranscriptInsert`, not `onTranscriptSend`. It checks component lifetime,
current account/user and the original insertion callback before upload and again
before inserting a response. The modal closes on navigation, account/composer
change or explicit cancellation; late results cannot populate another draft.

Audio stays in browser memory until the user selects Transcribe or Save. The
dialog does not save recordings on the server or add audio attachments to chats.
Transcribe explicitly sends the audio to OpenAI. Failure retains the current
browser preview for retry or download. Closing releases object URLs, timers and
microphone tracks; cancellation also aborts an outstanding transcription request.

Limits: 20 MiB per file, five-minute browser recordings and a 90-second
transcription timeout. The file selector accepts WAV, MP3, M4A/MP4, WebM, OGG and
FLAC. Missing/generic file MIME types are normalized from recognized extensions;
actual codec support still depends on the browser and transcription service.

## Validation

- Real LAN HTTP browser: generated a short synthetic WAV locally, selected it,
  transcribed through the existing account, and observed the expected English
  sentence in the composer. No chat message was sent. The test draft was cleared.
- Localhost browser: recording button enabled; LAN HTTP: disabled with file
  fallback. Real microphone capture was not started during automated validation.
- Dialog layout checked at 360x800 and 320x640. Buttons are at least 44px high;
  narrow viewports can scroll the dialog. This is browser viewport testing, not
  physical Samsung testing.
- Fifteen dictation checks cover validation/MIME, explicit upload, cancellation,
  late responses, account/composer changes, service retry, empty transcripts,
  microphone denial, late permission, recording time limit, track release,
  timeout and retained native availability gates. Recording uses a test double.
- All 41 targeted tests pass against each platform's clean patched tree. Both
  24-patch series replay with zero fuzz/offsets; Windows files match the running
  installation. macOS runtime and phone HTTPS capture remain unverified.

Generated audio and screenshots are ignored local validation artifacts.
