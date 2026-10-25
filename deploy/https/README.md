# Codex Web HTTPS in the existing nginx

One Docker container, `next-nginx`, serves Codex and the existing local-v2/local-v3 sites. Its image remains `nginx:1.25.1`; unrelated site configuration and upstream ports were preserved. The temporary `codex-web-https` container was removed.

## Addressing

| Docker published listener | nginx listener | Sites |
| --- | --- | --- |
| `127.0.0.1:443` | `443` | local-v2, local-v3, web-codex |
| `192.168.5.110:443` | `8444` | web-codex only |

Every user-facing URL uses normal HTTPS port 443. The separate LAN listener rejects other TLS names, so it does not expose the development sites.

Public DuckDNS A: `web-codex.duckdns.org -> 192.168.5.110`. This is LAN/VPN access. On this Windows host, `hosts` maps the domain to `127.0.0.1`, matching the existing local-v2/local-v3 convention and avoiding mirrored WSL's host-to-LAN limitation. `configure-local-https.ps1` applies that one mapping with a backup and the narrow Windows firewall rule. It also removes this setup's unsuccessful experimental 443 port proxies. Existing 8214 and other port proxies remain unchanged.

Allowed Codex clients: `192.168.5.0/24`, `192.168.1.0/24`, VPN peers `10.20.0.1` and `10.20.0.2`, localhost, the current Docker bridge gateway `172.18.0.1`, and the approved 3x-ui Docker network `10.250.2.0/24`. Keep these values aligned if the host/network changes. The Windows rule uses Private profile and Ethernet 6. No router forwarding or changes to default WSL routes/firewall policy were made.

## LAN return route and phone VPN

The WSL default route points into VPNKit (`wsltap`). Replies to routed LAN/VPN
clients must instead return through `192.168.5.1`. A separate service,
`codex-web-https-lan-route.service`, maintains only TCP source port 443 using rule
priority 18441 and its own routing table 18444. It detects the current interface
for `192.168.5.110` and repairs the route after network changes. The existing
3x-ui UDP route/service and table 18443 are unchanged.

Maintained sources are `https-lan-route.sh`, `https-lan-route-watch.py`, and
`codex-web-https-lan-route.service`. Installed copies are in Ubuntu WSL under
`/usr/local/sbin/codex-web-https-lan-route`,
`/usr/local/sbin/codex-web-https-lan-route-watch`, and `/etc/systemd/system/`.

```powershell
wsl -d Ubuntu -u root -- systemctl status codex-web-https-lan-route.service --no-pager
wsl -d Ubuntu -u root -- /usr/local/sbin/codex-web-https-lan-route --check
wsl -d Ubuntu -u root -- ip rule show priority 18441
```

The user also has a phone VPN terminating in the `3x-ui` container. With explicit
approval, `next-nginx` joins the existing external `3xui_xui_egress` network with
the alias `web-codex.duckdns.org`. Docker DNS inside 3x-ui resolves this directly
to nginx (initially `10.250.2.4`), while public DNS still points to the LAN IP.
Two HTTPS requests from 3x-ui returned 200 with normal certificate validation.
The shared Compose override persists the network and alias; it does not add any
public port. This avoids routing the VPN server's domain lookup through its own
Windows LAN address. A VPN client that sends only a pre-resolved destination IP
may require separate handling; a container check alone does not prove that mode.

The user added `codex-web-https` and the destination route from
`wireguard-codex-route.json` through the 3x-ui UI, before the general private-IP
`direct` rule, and confirmed phone WireGuard access. Their rule also selects
the existing Hysteria2 and office-VPN inbounds. The match uses destination
`192.168.5.110/32:443`; source IP/port must remain empty.

## Installed Android PWA

On 2026-10-25 the Samsung Chrome PWA stalled at the startup logo while the
ordinary Chrome tab worked. The user disabled v2rayNG's per-app filtering,
connected successfully, then explicitly included the installed app in VPN
routing. They confirmed that it now works both on Wi-Fi and through VPN.
When diagnosing this difference, inspect the installed app's VPN inclusion as
well as Chrome's; do not assume that both take the same path.

Separate nginx logs showed upstream TCP-connect timeouts (504) for UI modules,
including requests over both the VPN and localhost paths. The Codex vhost now
uses upstream keepalive, HTTP/2 with 32 concurrent streams, and gzip/buffering
only for static `/assets/` requests. WebSocket upgrades and streaming remain
enabled. Access logs include timestamps and upstream timings, but no queries.
The configuration passed `nginx -t` and was reloaded gracefully. A large JS
asset returned HTTP/2 200 with gzip (2,179,602 transferred bytes in 0.45 seconds
in the local container check). This check is not a phone throughput benchmark.
The pre-change live vhost is saved as `codex-web.conf.before-pwa-20261025`.

## Live files

Active Compose files:
- `C:/Users/kostaz/Documents/1_git_repositories/frontend_v3/docker-compose.yml`
- `C:/Users/kostaz/Documents/1_git_repositories/et-workspace/.generated/company-limits-20261021/nginx-https.yml`

The second file publishes the two listeners, mounts the Codex certificate directory and this repository's `start-nginx.sh`, uses that startup script, and sets `restart: unless-stopped`. Its original is saved alongside it as `nginx-https.yml.before-codex-https-20261025`.

`codex-web.conf` is the maintained source. Its deployed copy is `C:/Users/kostaz/Documents/1_git_repositories/et-workspace/.generated/company-limits-20261021/nginx-conf/codex-web.conf`. After changing it, copy it there, run `docker exec next-nginx nginx -t`, then `docker exec next-nginx nginx -s reload`. If the generated frontend deployment is replaced, carry forward this vhost and the certificate/start-script mounts.

## Certificates

The existing `acme-duckdns` daemon, also used for `kostaz-pc.duckdns.org`, owns the DuckDNS token. It was reused without copying the token into this repository or nginx. DNS-01 changes only the challenge TXT record, not the domain A record.

One-time issuance and installation:

```powershell
docker exec acme-duckdns --issue --server letsencrypt --dns dns_duckdns -d web-codex.duckdns.org --keylength ec-256 --dnssleep 60
docker exec acme-duckdns --install-cert -d web-codex.duckdns.org --ecc --key-file /cert/web-codex.duckdns.org/privkey.pem --fullchain-file /cert/web-codex.duckdns.org/fullchain.pem
```

The daemon checks renewals four times daily. `--install-cert` persists the output paths. The Windows certificate directory is `C:/Users/kostaz/Documents/1_docker_composes/3xui/cert/web-codex.duckdns.org`, mounted read-only at `/etc/nginx/tls`.

`start-nginx.sh` detects a changed cert/key pair every minute, validates it with `nginx -t` and gracefully reloads nginx. Partial or invalid updates are retried without replacing the working configuration. No Docker socket is mounted. The initial certificate expires on 2027-01-23; ACME selected 2026-12-25 for renewal. These dates are a snapshot, not permanent configuration.

## Verification and operation

```powershell
curl.exe --noproxy '*' -I https://web-codex.duckdns.org/
docker exec next-nginx nginx -t
docker exec acme-duckdns openssl x509 -in /cert/web-codex.duckdns.org/fullchain.pem -noout -issuer -subject -dates
docker exec acme-duckdns --list
docker logs --tail 30 next-nginx
```

Checks on 2026-10-25:
- Windows HTTPS returns 200 with normal certificate validation.
- WebSocket upgrade returns 101; cross-origin browser IPC requests are rejected.
- A changed certificate file triggers successful graceful reload in the shared nginx. This tests deployment of renewed files, not a forced extra issuance.
- local-v3 returns 200 on its original HTTPS 443 address.
- The user confirmed access from LAN after correcting the WSL return route.
- local-v2 reaches nginx on 443 but returns 502: its unchanged upstream `host.docker.internal:55342` refuses connections even when contacted directly. That application was not started or reconfigured by this setup.
- Pre-existing duplicate local-v2/local-v3 server-name warnings remain in the frontend's configuration; they were not introduced by the Codex vhost.

On HTTPS the browser can offer microphone recording; permission remains up to the user. Preferences/local storage are separate from the previous HTTP origin.

To roll back the integration, restore the saved Compose override, remove only the deployed Codex vhost, and recreate only the `nginx` service using the two Compose files above. Remove only the `web-codex.duckdns.org` hosts line and the `CodexWeb-HTTPS-443-20261025` firewall rule if withdrawing HTTPS entirely. Do not overwrite the whole hosts file if unrelated changes occurred afterwards.

References: [ACME Docker usage](https://github.com/acmesh-official/acme.sh/wiki/Run-acme.sh-in-docker), [DuckDNS API](https://www.duckdns.org/spec.jsp), [nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html), [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking).
