# upgrading

instructions for upgrading codex-web to point at a new version of upstream
Codex Desktop.

## Windows distribution

The Windows and macOS archives can contain different bundles for the same
Desktop version. Keep the Mac archive patches in `patches/*.patch` and the
installed Windows archive variants in `patches/windows/*.patch`. Both use the
order in `patches/series.json`. Port and verify each set against its own clean
archive; do not assume matching version numbers imply matching file hashes.

On Windows, `scripts/prepare-windows.ps1` extracts the installed archive (or
`-AppAsar`) into a new output folder and applies the Windows variants. Update
the shared Desktop/CLI pins and archive digests in `patches/series.json`, plus
the platform CLI package integrity values in `nix/codex/default.nix`. Keep extracted sources and runtime state out of Git.

## Activity and browser feature parity

Keep `src/browser/feature-gates.ts` aligned with the pinned upstream UI. Activity
uses gate `4039078146` for both the bell and contextual-sidebar selection. Retain
the shared Statsig override adapter patch on both platforms; do not replace the
account access checks or rebuild the list from DOM content. Review the native
recency, unread and interaction-time logic when its bundle contract changes.

Replay the full series on clean **formatted** extracted sources. The output must
be a new directory. This verifier rejects fuzz and line offsets and can compare
the result to the running patched sources without replacing them:

```powershell
node scripts/verify-patches.mjs --platform windows --baseline scratch-installed/asar --output scratch-verify-windows --compare scratch/asar
$env:CODEX_WEB_ASAR_DIR = (Resolve-Path scratch-verify-windows).Path
node --test tests/activity.test.cjs
node scripts/verify-patches.mjs --platform macos --baseline scratch-macos-unmodified --output scratch-verify-macos
$env:CODEX_WEB_ASAR_DIR = (Resolve-Path scratch-verify-macos).Path
node --test tests/activity.test.cjs
```

Use GNU patch (Git for Windows or `patch` on Unix); `CODEX_WEB_PATCH` can select
its executable. Without `CODEX_WEB_ASAR_DIR`, only the adapter unit tests run and
the upstream contract checks are explicitly skipped. Follow with browser checks:
bell, live Priority/recents, filter persistence, opening a chat, and mobile drawer.
See [Activity evidence and behavior](docs/activity.md).

Preserve `webview-thread-activity.patch` and `src/browser/thread-activity.ts`.
Recheck the native list subscription RPC lifetime (`Yw.subscribe`), follower
retention/disposal, catalog attention selector (`oMi`) and Activity recency cache
(`G5i`) against the new bundle. Run `node --test tests/thread-activity.test.cjs`
with `CODEX_WEB_ASAR_DIR` set for each platform. A fresh browser home page must
show a chat running in another Desktop window before selecting it. Verify live
updates and distinguish active spinners from unread dots. `thread/list` and
`thread/loaded/list` from a separate app-server do not establish cross-client
activity. Do not use mass resume or mark-read operations to populate indicators.

Also retain `webview-activity-view.patch` and `src/browser/activity-view.ts`:
explicit bell/shortcut choices persist per mode in localStorage, then restore
through native activation once per store. Recheck `RDt`, `zDt`, `c6n` and `VDt`
when upgrading. Internal cleanup must not overwrite the saved user preference.
Verify both on and off after reload, plus a fresh visit to the same origin.

Also run `node --test tests/mobile.test.cjs` against each patched tree. Preserve
the mobile navigation store bridge, navigation/panel hooks and hover guards in
`webview-mobile.patch`. Rebuild the preload to bundle the matching mobile CSS.
Use the [mobile acceptance checks](docs/mobile-layout.md), including tool tabs,
repeated drawer dismissal, narrow/landscape screens and Desktop fallback.

## Browser dictation

For browser dictation, preserve `webview-dictation.patch`,
`src/browser/dictation.ts` and `assets/dictation.css`. Recheck the native Codex
availability policy (`iBt`), recording entry (`CKs`), authenticated multipart
transcription (`dmo`) and insert-only callback contract. Run
`node --test tests/dictation.test.cjs` against both patched trees. Verify HTTP file
transcription and the HTTPS/localhost microphone capability separately; never
force account/workspace gates or enable insecure-origin microphone flags. See
[dictation validation](docs/dictation.md).

## Safe preparation and publication

1. Keep the running prepared tree and its source revision as the rollback point.
   Do not delete or modify it to test a Desktop upgrade. Keep production
   `scratch-pwa/` outside the candidate tree.
2. Obtain the intended official Desktop archive and bundled CLI. Port each platform
   separately; update `patches/series.json` only after reviewing the new sources.
   The Windows archive SHA-256, Mac ZIP SHA-256, Desktop version and CLI version
   are pinned there. Nix CLI integrity hashes also need updating when CLI changes.
   The download inventory tool refuses invalid signatures. Changing just a version
   string is not an upgrade.
3. Extract an untouched baseline, format the patched files with the locked Prettier,
   and port the small bundle hooks. Keep mobile UI, cache and transport logic in
   maintained `src/browser`, `src/server`, and `assets` modules. Generate each
   patch with a diff against the output of all preceding patches; never hand-write
   hunk counts. Add it to the shared ordered series for both platforms.
4. Replay the series with `scripts/verify-patches.mjs` as above. Production
   preparation uses the same strict applicator: any failed hunk, fuzz or line
   offset stops it. Both platform trees must pass the contract tests.
5. On Windows, prepare and build in a new directory (choose a fresh name per run):

```powershell
./scripts/prepare-windows.ps1 -AppAsar 'C:/path/to/reviewed/app.asar' -OutputDirectory scratch-candidate/asar
$env:CODEX_WEB_ASAR_DIR = (Resolve-Path scratch-candidate/asar).Path
$env:CODEX_WEB_PWA_DIR = Join-Path (Get-Location) 'scratch-candidate-pwa'
npm.cmd run build:server
npm.cmd run build:browser
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
Remove-Item Env:CODEX_WEB_ASAR_DIR
Remove-Item Env:CODEX_WEB_PWA_DIR
```

The build emits an immutable release inventory and worker plus content-addressed
public assets. It never caches RPC, local project files or conversation data.
A test marker is not a substitute for browser checks of existing history, a new
prompt, Activity, mobile sheets, dictation, deep-link reload and sleep/resume.
Native macOS/Linux runtime acceptance still needs those platforms.

6. Publish in a maintenance window: stop only Codex Web, retain the current
   `scratch/asar` as a uniquely named backup within the checkout, and switch in
   the verified candidate. Keep the production `scratch-pwa` directory. Build
   the matching server/browser and run `build:pwa` with the production store
   before starting the new server. Do not rebuild files underneath active
   first-load clients. Server releases must accept the previous browser wire
   protocol while old cached windows remain. Do not replace the shared nginx or
   change its other sites to publish a Codex update.
7. Check HTTP/HTTPS, opening an existing chat and the browser console. Confirm
   active/latest PWA versions in the diagnostic DOM attributes. A waiting update
   takes effect after old Codex Web windows close; never force-reload a draft.
8. If verification fails, stop Codex Web and restore the previous source revision
   and prepared tree, rebuild its server, retain the immutable object store, then
   restart with its matching CLI. Keep old protocol support until clients finish
   transitioning. A worker cannot be assumed compatible with an arbitrary older
   server; roll back the server and browser release as a tested pair.

Desktop updates are intentionally manual. Failing closed on an unknown archive
is preferable to silently publishing partly applied patches.

See [the architecture review](docs/architecture-review-2026-10-25.md) and
[PWA release behavior](docs/pwa-cache.md) for the validated boundaries.
