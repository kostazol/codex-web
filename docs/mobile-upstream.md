# Desktop base and Android mobile reference

Checked 2026-10-25 against ChatGPT Android **1.2026.293 (2629319)** and
Codex Desktop **26.1021.31345**. Android's Codex Remote lives in
`com.openai.chatgpt`; it is not a separate Codex APK.

The Android XAPK was downloaded from the APKPure page supplied by the owner.
Google apksig 9.4.1 verified the v3 signature of the base and all three splits.
Every signer matched the certificate published for `com.openai.chatgpt` at
[OpenAI's assetlinks endpoint](https://chatgpt.com/.well-known/assetlinks.json).
Package name and version code were read from each signed binary manifest, not
trusted from the mirror's label. Hashes, split identities and discovered markers
are pinned in [android-reference.json](android-reference.json).

## What the package contains

Nine DEX files, native/Compose code, Valdi modules and nine HTML/JS/CSS candidates
were inventoried. The web candidates implement maps, LaTeX and Spaces visualizations.
No reusable Codex Remote HTML/JS entry point was found. The inspected Remote UI
methods create Compose layout nodes and modifiers; they are not an Electron webview.

JADX 1.5.6 was used for targeted static inspection. Obfuscation and decompiler
warnings prevent treating the output as complete, buildable original source.
These references identify evidence in this exact APK; class aliases may change
on the next release. Decompiled code and APK assets are not distributed here.

| APK evidence | Confirmed structure | Web adaptation |
| --- | --- | --- |
| `dol.b/d/e`, `classes4.dex` | Home host selector, host chip and host identity use Compose | Retain Desktop's actual host/project state and actions; do not create a second host registry |
| `gpm.a/b`, `classes4.dex` | Model menu and model chips | Keep the live Desktop model catalog, present composer menus as phone bottom sheets |
| `ov81.a`, `classes3.dex` | Permission picker driven by the selected preset and available options | Keep native Desktop approval choices and confirmation dialogs |
| `ew81.a/b/c/d`, `classes3.dex` | Composer status bottom sheet, top bar and rows | Use bottom sheets for secondary composer controls, safe areas and scrollable content |
| `ytj.a`, `classes4.dex` | Host connection content | Keep host connection feedback; do not confuse a connected web socket with a ready remote computer |
| `apl`, `classes.dex` | Session repository refreshes projects, app-server sections, model metadata and composer references | Continue using the host's live sessions through the existing Desktop bridge |

Pairing, host management, confirmation and thread screen markers are also present.
Their presence alone does not establish a complete transport specification.
The Android app was **not installed or run**; Android screenshots, biometric
unlock, device enrollment, relay behavior and physical keyboard behavior have
not been validated. This is an Android-informed web layout, not a pixel-identical
Android port or an implementation of OpenAI's Remote pairing protocol.

## Two independent update paths

**Desktop provides the runnable base.** Extract the pinned Desktop bundle and
replay the existing platform patch series. Both platform variants include stable
mobile hooks and editor keyboard changes.

**Android provides a versioned mobile reference.** Verify and inventory an updated
APK, compare it to the previous reference, inspect changed Remote components, then
implement the relevant interactions in the browser layer:

- `assets/mobile.css`: touch layout, safe areas, drawers and composer bottom sheets.
- `src/browser/mobile.ts`: visual viewport, drawer focus and menu portal tagging.
- `patches/webview-mobile.patch` and its Windows variant: viewport metadata and
  stable application hooks.
- `webview-prosemirror-inputmode.patch`: phone Return/newline and software keyboard.

Native DEX changes cannot become webview text patches. An Android asset extraction
patch target is appropriate only if a future APK actually ships a reusable Remote
web bundle and its bridge contract has been verified. In this version, Android
updates are reviewed through the reference inventory.

## Repeatable static verification

Keep downloaded APK/XAPK files, tools, decoded resources and reports under the
ignored `scratch-android/` directory. Downloading is separate from application
startup. The mirror's `version=latest` URL is mutable; compare actual hashes.
Python 3.11+ and JDK 17+ are required for the full check.

Download Google's verifier from
[Google Maven](https://dl.google.com/dl/android/maven2/com/android/tools/build/apksig/9.4.1/apksig-9.4.1.jar).
The script enforces its SHA-256 before execution. It accepts APK or XAPK input,
verifies all splits, checks their version consistency and refuses unsafe nested
paths, duplicates and recursive packages. Without `--apksig-jar`, output is an
**unverified inventory** and never claims publisher verification.

```powershell
python scripts/inspect_android.py scratch-android/download/chatgpt.xapk `
  --apksig-jar scratch-android/tools/apksig-9.4.1.jar `
  --compare docs/android-reference.json `
  --output scratch-android/next-inventory.json
```

The comparison lists added/removed Remote markers and web candidates and flags a
changed package for UI review. It does not execute or automatically import APK code.
The pinned publisher fingerprint must be re-reviewed against OpenAI's endpoint
if the signing certificate changes. A mismatch fails the check.

To inspect specific classes, use the official
[JADX 1.5.6 release](https://github.com/skylot/jadx/releases/tag/v1.5.6).
The ZIP used here had SHA-256
`545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974`,
matching the release asset digest. Redirect JADX's configuration/cache to local
scratch directories; decompile only the classes needed for the current review.

## Validation for this update

For the subsequent Samsung S20 navigation/layout corrections and current mobile
acceptance contract, see [Mobile interaction contract](mobile-layout.md).

- All four real APKs: valid v3 signature, expected publisher/package, same version code.
- Inventory tests: path traversal, duplicate entries, recursive packages, verifier
  hash gate, unverified reporting, upstream comparison; real signed fixture accepted,
  byte-modified fixture and wrong publisher rejected.
- Browser: composer menus at 320, 390, 768 and 1280px; 390x430 reduced-height viewport;
  no horizontal page overflow, phone sheets stay inside the viewport, Desktop uses
  its original anchored menu.
- Opening a sheet does not select the item under the original pointer. Repeated
  permissions-menu opening leaves the preset unchanged and opens no confirmation.
  Escape and tapping outside dismiss normally; existing drafts survive reload.

Browser viewport tests do not substitute for physical Android/iOS testing.
Official product references:
[Remote connections](https://learn.chatgpt.com/docs/remote-connections),
[Google Play](https://play.google.com/store/apps/details?id=com.openai.chatgpt).
