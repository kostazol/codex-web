#!/usr/bin/env bash
# Managed by codex-web/deploy/https/https-lan-route.sh.
set -euo pipefail

# Docker's HTTPS proxy otherwise replies through the WSL VPNKit default route.
# Route replies from TCP 443 through LAN without changing other traffic.
LAN_IP="192.168.5.110"
LAN_NET="192.168.5.0/24"
LAN_GATEWAY="192.168.5.1"
TCP_PORTS=("443")
ROUTE_TABLE="18444"
RULE_PRIORITIES=("18441")

mode="${1:-}"
if [[ $# -gt 1 ]] || [[ -n "$mode" && "$mode" != "--remove" && "$mode" != "--check" ]]; then
    printf 'Usage: %s [--check|--remove]\n' "$0" >&2
    exit 2
fi

# Serialize the watcher, installer and manual recovery operations.
exec 9>/run/lock/codex-web-https-lan-route.lock
flock -x -w 40 9

existing_rules=()
all_rules_present=true
for index in "${!TCP_PORTS[@]}"; do
    priority="${RULE_PRIORITIES[$index]}"
    port="${TCP_PORTS[$index]}"
    existing_rules[$index]="$(ip -4 rule show priority "$priority")"
    expected_rule="^${priority}:[[:space:]]+from all ipproto tcp sport ${port} lookup ${ROUTE_TABLE}$"
    if [[ -n "${existing_rules[$index]}" ]]; then
        rule_count="$(printf '%s\n' "${existing_rules[$index]}" | wc -l)"
        if [[ "$rule_count" -ne 1 ]] || ! grep -Eq "$expected_rule" <<< "${existing_rules[$index]}"; then
            printf 'Routing priority %s belongs to another rule; refusing to change it.\n' "$priority" >&2
            exit 1
        fi
    else
        all_rules_present=false
    fi
done

if [[ "$mode" == "--remove" ]]; then
    for index in "${!TCP_PORTS[@]}"; do
        if [[ -n "${existing_rules[$index]}" ]]; then
            ip -4 rule delete priority "${RULE_PRIORITIES[$index]}" ipproto tcp sport "${TCP_PORTS[$index]}" lookup "$ROUTE_TABLE"
        fi
    done
    ip -4 route delete table "$ROUTE_TABLE" default via "$LAN_GATEWAY" 2>/dev/null || true
    ip -4 route delete table "$ROUTE_TABLE" "$LAN_NET" 2>/dev/null || true
    exit 0
fi

# Validate all entries before changing our table. This also lets us restore a
# missing rule when the only remaining routes are the ones owned by this script.
table_state() {
    python3 - "$ROUTE_TABLE" "$LAN_NET" "$LAN_GATEWAY" "$LAN_IP" "$1" "${2:-}" <<'PY'
import json
import subprocess
import sys

table, network, gateway, source, mode, interface = sys.argv[1:]
result = subprocess.run(["ip", "-j", "-4", "route", "show", "table", table],
                        capture_output=True, text=True)
if result.returncode and "FIB table does not exist" not in result.stderr:
    sys.stderr.write(result.stderr)
    sys.exit(1)
routes = [] if result.returncode else json.loads(result.stdout or "[]")
seen = set()
for route in routes:
    destination = route.get("dst")
    owned = (destination in ("default", network)
             and route.get("prefsrc") == source
             and bool(route.get("dev"))
             and route.get("type", "unicast") == "unicast"
             and not route.get("multipath")
             and destination not in seen)
    if destination == "default":
        owned = owned and route.get("gateway") == gateway
    else:
        owned = owned and not route.get("gateway") and route.get("scope") == "link"
    if not owned:
        sys.stderr.write(f"Routing table {table} contains an unmanaged route; refusing to change it.\n")
        sys.exit(1)
    if mode == "complete" and route["dev"] != interface:
        sys.exit(1)
    seen.add(destination)
if mode == "complete" and seen != {"default", network}:
    sys.exit(1)
PY
}

table_state owned

lan_interface=""
attempts=30
if [[ "$mode" == "--check" ]]; then
    attempts=1
fi
for ((attempt = 0; attempt < attempts; attempt++)); do
    lan_interface="$(ip -o -4 address show | awk -v address="$LAN_IP" '{split($4, parts, "/"); if (parts[1] == address) {print $2; exit}}')"
    if [[ -n "$lan_interface" ]]; then
        lan_interface="${lan_interface%%@*}"
        break
    fi
    if (( attempt + 1 < attempts )); then sleep 1; fi
done
if [[ -z "$lan_interface" ]]; then
    printf 'LAN address %s is unavailable; routes were not changed.\n' "$LAN_IP" >&2
    exit 1
fi

if "$all_rules_present" && table_state complete "$lan_interface"; then
    exit 0
fi
if [[ "$mode" == "--check" ]]; then
    exit 1
fi

ip -4 route replace table "$ROUTE_TABLE" "$LAN_NET" dev "$lan_interface" scope link src "$LAN_IP"
ip -4 route replace table "$ROUTE_TABLE" default via "$LAN_GATEWAY" dev "$lan_interface" src "$LAN_IP"
for index in "${!TCP_PORTS[@]}"; do
    if [[ -z "${existing_rules[$index]}" ]]; then
        ip -4 rule add priority "${RULE_PRIORITIES[$index]}" ipproto tcp sport "${TCP_PORTS[$index]}" lookup "$ROUTE_TABLE"
    fi
done
printf 'HTTPS TCP %s replies use %s, gateway %s, source %s.\n' "${TCP_PORTS[*]}" "$lan_interface" "$LAN_GATEWAY" "$LAN_IP"
