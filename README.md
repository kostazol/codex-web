# codex-web

a browser frontend for codex desktop, running on a machine you control.

This fork tracks Codex Desktop **26.1021.31345** and its bundled Codex CLI
**0.164.0-alpha.11.1**. See [upgrade validation](docs/desktop-26.1021.31345.md)
for tested behavior and known limitations.

https://github.com/user-attachments/assets/0a33cbd8-741c-412c-9e75-46dfe9324596

## motivation

the agents were never meant to stay trapped in a terminal window for long.
codex desktop brought the power of agents to your local computer, where your
files, credentials, and tools already live.

codex-web brings codex desktop to the browser while keeping the backend on a
machine you control (a linux box in the cloud, your home lab, or a desktop / mac
mini). agents keep running after your laptop closes. you can reconnect from any
device with a browser.

this project aims to be as thin a wrapper as possible to ensure upstream changes
to the codex desktop app can be integrated quickly.

## usage

`codex-web` serves the browser client and hosts the desktop-side bridge. by
default, it listens on `127.0.0.1:8214`.

it will use `codex` from `PATH` if available, or `CODEX_CLI_PATH` if you set
it.

run it with `npx`:

```bash
npx --yes github:kostazol/codex-web
```

or with nix:

```bash
nix run github:kostazol/codex-web
```

then open <http://127.0.0.1:8214> in a browser.

### Windows using an installed Codex Desktop

Requires Node.js 22.12 or newer, Git for Windows, and the pinned Desktop version above.
Run these commands in PowerShell from this checkout:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd rebuild better-sqlite3 electron
./scripts/prepare-windows.ps1
npm.cmd run build:browser
npm.cmd run build:server
./scripts/start-windows.ps1
```

Preparation extracts a copy of the installed Desktop archive and applies the
Windows variants of the same ordered patches used by the Unix build. It does not modify Desktop's
installation. It refuses to overwrite an existing output directory; preserve
the old `scratch` directory under another name before preparing again.

The launcher uses Desktop's bundled CLI and existing Codex sign-in. It starts
a hidden process on `http://127.0.0.1:8214`; logs and its PID are in
`scratch-runtime/`. To stop only this server, run
`./scripts/stop-windows.ps1`. It is not installed as a Windows service.

Existing local chats and projects are read from the same Codex profile. No
one-time history import is needed. Native-only Desktop features are not all
implemented by the browser bridge.

The Windows launcher uses Electron's Chromium network stack for Desktop account
requests. This fixes the workspace-settings 403 seen with Node fetch on this
host. The application still runs on Node, so SQLite keeps the correct ABI.
`-NetworkTransport node` is available for diagnosis; it may reproduce that 403.

### Phone and tablet browsers

At widths up to 768px, navigation becomes a drawer, the chat uses the full width,
and controls have larger touch targets. The composer follows the visual viewport
and safe areas. Phone Return inserts a newline; use Send to submit. Desktop
keyboard behavior remains unchanged. Physical Android/iOS keyboard validation is
still required in addition to the browser viewport checks.

Composer menus open as bottom sheets on phones, with scrollable choices and larger
targets. The opening tap cannot accidentally select an item beneath it. Desktop's
model catalog, permission presets, confirmations and menu focus remain authoritative.

The mobile layer is maintained separately from the Desktop bundle patches. Its
interaction reference is the signature-verified ChatGPT Android 1.2026.293 APK;
the inspected Codex Remote screens are native Compose, so they are implemented
explicitly in the web layer rather than extracted as a second HTML bundle.
See [mobile upstream and Android package workflow](docs/mobile-upstream.md).
No Android APK or Android source code is bundled in this fork.

### sign in

ensure the codex cli on the host machine is signed in before starting the
server.

```bash
codex login --device-auth
```

### proxying to app-server (advanced usage)

it’s often useful to run the app server separately, so a crash or restart of
codex-web doesn’t interrupt the codex process executing commands.

it's possible to hook codex-web up to an already-running app server using the
`codex_remote_proxy` script.

start a long-lived app server somewhere:

```bash
mkdir -p /tmp/codex-app-server
cd /tmp/codex-app-server
codex app-server --listen unix://codex-app-server.sock
```

then run `codex-web` with the proxy helper:

```bash
nix shell github:kostazol/codex-web github:kostazol/codex-web#codex_remote_proxy -c bash -lc '
  export CODEX_UNIX_SOCKET=/tmp/codex-app-server/codex-app-server.sock
  export CODEX_CLI_PATH="$(command -v codex_remote_proxy)"
  codex-web
'
```

`codex app-server proxy --sock ...` is a raw stdio protocol bridge for another
program to use; when run directly in a terminal it will wait for protocol input
rather than opening an interactive prompt.

## security

run `codex-web` only on trusted networks. treat anyone who can reach the
`codex-web` server as someone who can operate codex on the host machine as the
same user running the server.

if you need authn or authz, implement it outside of `codex-web`: proxy it through
wireguard, tailscale, or an ssh tunnel and put an authentication gateway or
reverse proxy in front.

someone with access to the web ui may be able to:

- run commands on the host, limited only by the permissions of the `codex-web`
  server process.
- read or modify files, environment variables, credentials, ssh keys, and other
  local resources that are accessible to that process.
- use the codex / chatgpt account already signed in on the host. this may
  consume usage quota or billing credits, and may expose account metadata shown
  by the app or cli, such as name or email address.

## features

- hostable on macOS, Linux (and anything codex cli + node will run on)
- reachable from the browser
- thin wrapper, so updates should land fast
- working today:
  - subagents
  - inline images
  - editor sidepanel
  - transcription

## roadmap

some parts of the desktop experience are not wired up yet:

- browser panel support, likely rebuilt around iframes
- computer use on linux, which could become a very powerful feature
- terminal support
- git worker integration
- whatever else people find and file issues for

## issues welcome

if something is broken, missing, or rough around the edges, please file an
issue.

using `codex-web` in an interesting way? post about it on x and tag me
[@0xcaff](https://x.com/0xcaff).

using this at a company and need something more tailored? email me and we can
talk.

## alternatives

* [davej/pocodex](https://github.com/davej/pocodex) i used this until the wheels fell off. i needed subagents
  and an inline image viewer. this didn't have them and was having a hard time
  keeping up with upstream codex updates.
* [Official mobile Remote connections](https://learn.chatgpt.com/docs/remote-connections)
  can connect ChatGPT on Android/iOS to a supported Windows or Mac host. This
  uses OpenAI's pairing and relay infrastructure; it is separate from this
  self-hosted HTTP browser bridge.
