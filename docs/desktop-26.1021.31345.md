# Desktop 26.1021.31345 upgrade

Updated from upstream commit `2424e8548db3eebeb49eef5057ef750688bb680b`
(Desktop 26.1007.30912). The Windows Desktop updater reported 26.1021.31345
as current on 2026-10-25. Its bundled CLI reports 0.164.0-alpha.11.1.

## Changes

- Regenerated all 19 patches from edits to the extracted, formatted Desktop
  sources. Routing and Statsig initialization moved into
  `initialize-app-host-services`; local file URLs moved into `app-initial`.
- Keep separate Windows and Mac patch sets: their bundle filenames differ
  despite matching Desktop version numbers. Windows preparation uses
  `patches/windows`, while Unix/Nix uses `patches` and the official Mac archive.
- Kept the existing browser behavior: deep links, titles, sidebar dismissal,
  editor input mode, local images, PWA assets, and JSON-compatible RPC messages.
- Added the GPU feature status and session callbacks used by the new Windows
  shell, and Chromium version metadata needed by its HTTP client.
- Ignore messages for already destroyed renderer windows instead of crashing
  the whole server after a failed renderer startup.
- Added Windows preparation, hidden launch with HTTP readiness checking, and
  PID-validated shutdown scripts. CLI hashes come from the official npm
  registry's published SHA-512 integrity values for each platform.

## Validation

Performed on Windows with Node.js 22.18.0 and the installed Desktop archive:

- All 19 patches apply to a fresh extraction. Each resulting patched file
  matches the corresponding in-place port byte for byte.
- TypeScript server compilation and Vite browser build pass.
- Server responds with HTTP 200 on loopback port 8214.
- Browser opens the Codex and Work surfaces and lists existing local projects
  and chats, without an import step.
- An existing chat loads its conversation, title, and ongoing Desktop updates.
  Reloading its `/thread/...` URL restores the same conversation.
- Windows scripts pass PowerShell syntax parsing. Preparation and launch were
  exercised against the installed Desktop distribution; shutdown and HTTP
  readiness checks also passed.

The previous 26.1007.30912 Mac archive was extracted and its original 19
patches applied successfully as the upgrade reference. The new official Mac
ZIP was downloaded completely and hashed:
`sha256-KvzVjgSEp2R5zKIxdOCFEnqdnmNGa3VznraCWl/2E/Q=`.
All 19 updated Mac patches apply to a fresh extraction, and all 10 patched
files match the Mac in-place port byte for byte. The two platform patch sets
were generated independently from actual file diffs.

Nix and native macOS/Linux execution have not been tested on this Windows host.

## Known limitations observed during validation

- Some ChatGPT account/settings and Statsig requests return HTTP 403 with
  `cloudflare_challenge` through the Node HTTP transport. The new-chat composer
  can display **Couldn't load workspace settings** and disable sending.
  A complete new-prompt/response test has therefore not passed. No account
  policy or challenge checks were disabled to hide this failure.
- The embedded Windows updater is unavailable, and the native Codex app-tools
  integration reports `missing-plugin`. Updating the pinned sources is manual;
  native Desktop integrations must not be assumed to work in the web wrapper.
- Some Windows access to saved WSL repositories produces Git ownership errors.
  This upgrade does not change the host's Git trust configuration.
- The server has no built-in authentication. The Windows launcher defaults to
  loopback and does not add a firewall rule or install a startup service.
