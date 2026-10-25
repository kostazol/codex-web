# upgrading

instructions for upgrading codex-web to point at a new version of upstream
Codex Desktop.

## Windows distribution

The Windows and macOS archives can contain different bundles for the same
Desktop version. Keep the Mac archive patches in `patches/*.patch` and the
installed Windows archive variants in `patches/windows/*.patch`. Both use the
order in `scripts/prepare_asar`. Port and verify each set against its own clean
archive; do not assume matching version numbers imply matching file hashes.

On Windows, `scripts/prepare-windows.ps1` extracts the installed archive (or
`-AppAsar`) into a new output folder and applies the Windows variants. Update
its version pin and the CLI check in `scripts/start-windows.ps1` together with
the Unix/Nix pins below. Keep extracted sources and runtime state out of Git.

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

Also run `node --test tests/mobile.test.cjs` against each patched tree. Preserve
the mobile navigation store bridge, navigation/panel hooks and hover guards in
`webview-mobile.patch`. Rebuild the preload to bundle the matching mobile CSS.
Use the [mobile acceptance checks](docs/mobile-layout.md), including tool tabs,
repeated drawer dismissal, narrow/landscape screens and Desktop fallback.

## backing up

we will start by generating a scratch directory and backing it up. first, let's
get the `scratch` directory to a known state by running the following

```bash
rm -rf scratch scratch-backup # remove existing past scratch directories to start from clean state
DEV=1 nix develop --command yarn run prepare:asar 
mv scratch scratch-backup
```

the `scratch-backup` directory holds the patched, working version of codex-web.
we will use this when moving the patches over to the new version to understand
the context the patches were being applied in.

## updating urls

there are a few places to update next.

1. `appVersion` in default.nix and `hash` in `codexZip`.
2. `APP_VERSION` in ./scripts/prepare

then temporarily comment out the patch lines in ./scripts/prepare_asar and run

```bash
DEV=1 nix develop --command yarn run prepare:asar 
cp -r scratch scratch-new-version-unmodified
```

## upgrading the codex-cli version

this part can be run concurrently with the rest of the upgrade process. make
sure to wait for its completion before doing validation. run it in a subagent.

run the following to get the version of the new codex-cli

```bash
scratch/ChatGPT.app/Contents/Resources/codex-cli/bin/codex --version
```

then update the `nix/codex/default.nix` file's `version` field and hashes to
point to the new version.

## porting over patches

now we have a few folders

* `scratch-backup`: patches applied on top of old version of Codex Desktop
* `scratch-new-version-unmodified`: plain extracted new version of Codex Desktop
* `scratch`: working copy we will be modifying

now carefully look at the patches in `patches/` and how they were applied in
`scratch-backup` and bring the changes over to `scratch`. apply them directly
in-tree first. don't worry immediately about updating the patches yet.

## updating patches

once the patches have been made in `scratch`, diff the changes in `scratch`
against `scratch-new-version-unmodified` and update the patches in `patches/`.
always generate the patches by running `diff` and always avoid writing the
patches manually as it's very easy to get them wrong.

once that is done, uncomment the patch lines in `scripts/prepare_asar` and run

```bash
mv scratch scratch-patched-inplace
rm -rf scratch
DEV=1 nix develop --command yarn run prepare:asar 
```

then diff `./scratch-patched-inplace` with the resulting `./scratch` to validate
the patches were applied as expected.

## validation

to validate things are still working, we'll first validate the server, then the
client. before starting this step, make sure to wait for the
`upgrading the codex-cli version` subagent to finish.

to validate the server, run the following

```bash
nix develop --command yarn server
```

next validate the client by opening a browser window to `http://localhost:8214`
and validating things show up on the page.

look in the console for errors. also, look on the screen to see whether any
error dialogs popped up. sometimes errors occur, but they're silent and exhibit
as loading taking forever (more than 1m). look out for that case too.

if there are errors, bring them to the users attention and we will decide how to
proceed.
