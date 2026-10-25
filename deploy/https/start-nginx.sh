#!/bin/sh
set -eu

certificate_digest() {
    sha256sum /etc/nginx/tls/fullchain.pem /etc/nginx/tls/privkey.pem
}

nginx -t
last_digest=$(certificate_digest)

# acme.sh renews into the mounted directory. Validate the complete cert/key
# pair before a graceful reload; retry on the next tick if copying is in flight.
# No Docker socket or DuckDNS API token is needed by this container.
(
    while sleep 60; do
        if current_digest=$(certificate_digest) && [ "$current_digest" != "$last_digest" ]; then
            if nginx -t && nginx -s reload; then
                last_digest=$current_digest
                echo 'Codex Web: renewed TLS certificate loaded.' >&2
            fi
        fi
    done
) &

exec nginx -g 'daemon off;'
