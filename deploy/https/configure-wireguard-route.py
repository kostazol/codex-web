"""Prepare/test, then optionally apply one 3x-ui route without changing clients."""
import argparse
import copy
import hashlib
import json
import sqlite3
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = Path(r"C:\Users\kostaz\Documents\1_docker_composes\3xui\db\x-ui.db")
CONTAINER = "3x-ui"
XRAY = "/app/bin/xray-linux-amd64"
PLAN = ROOT.parent.parent / "scratch-runtime" / "wireguard-route-plan.json"
PATCH = json.loads((ROOT / "wireguard-codex-route.json").read_text())


def docker(*args, data=None, check=True):
    result = subprocess.run(["docker", *args], input=data, capture_output=True)
    if check and result.returncode:
        # Configs may contain credentials. Never print captured config contents.
        raise RuntimeError(f"Docker operation failed with exit code {result.returncode}: {args[:3]}")
    return result


def runtime():
    return json.loads(docker("exec", CONTAINER, "cat", "/app/bin/config.json").stdout)


def patched(config):
    result = copy.deepcopy(config)
    tag = PATCH["outbound"]["tag"]
    if any(item.get("tag") == tag for item in result.get("outbounds", [])):
        raise RuntimeError("The dedicated outbound already exists; inspect before replacing.")
    result.setdefault("outbounds", []).append(PATCH["outbound"])
    result.setdefault("routing", {}).setdefault("rules", []).insert(0, PATCH["rule"])
    return result


def put_private(path, value):
    docker("exec", "-i", CONTAINER, "sh", "-c", f"umask 077; cat > {path}",
           data=json.dumps(value, ensure_ascii=False).encode())


def test_route(current):
    if not any(i.get("tag") == "in-8443-udp" and i.get("protocol") == "wireguard"
               for i in current["inbounds"]):
        raise RuntimeError("Expected WireGuard inbound changed.")
    check_path = "/tmp/codex-web-full-config-check.json"
    probe_path = "/tmp/codex-web-route-probe.json"
    pid_path = "/tmp/codex-web-route-probe.pid"
    log_path = "/tmp/codex-web-route-probe.log"
    probe_pid = None
    try:
        put_private(check_path, patched(current))
        docker("exec", CONTAINER, XRAY, "run", "-test", "-config", check_path)
        probe = {
            "log": {"loglevel": "warning"},
            "inbounds": [{"tag": "in-8443-udp", "listen": "127.0.0.1", "port": 10883,
                          "protocol": "socks", "settings": {"auth": "noauth"}}],
            "outbounds": [{"protocol": "blackhole", "tag": "blocked"}, PATCH["outbound"]],
            "routing": {"rules": [PATCH["rule"]]},
        }
        put_private(probe_path, probe)
        docker("exec", "-d", CONTAINER, "sh", "-c",
               f"umask 077; echo $$ > {pid_path}; exec {XRAY} run -config {probe_path} > {log_path} 2>&1")
        time.sleep(0.5)
        probe_pid = int(docker("exec", CONTAINER, "cat", pid_path).stdout)
        result = docker("exec", CONTAINER, "curl", "--noproxy", "", "--socks5", "127.0.0.1:10883",
                        "--resolve", "web-codex.duckdns.org:443:192.168.5.110",
                        "--connect-timeout", "5", "--max-time", "15", "-sS", "-o", "/dev/null",
                        "-w", "%{http_code}", "https://web-codex.duckdns.org/", check=False)
        if result.returncode or result.stdout.strip() != b"200":
            raise RuntimeError(f"IP-destination probe failed (exit={result.returncode}, status={result.stdout.decode()}).")
        print("Full Xray config validation: OK; IP-destination HTTPS probe: 200 (TLS verified).")
    finally:
        if probe_pid:
            command = docker("exec", CONTAINER, "cat", f"/proc/{probe_pid}/cmdline", check=False).stdout
            if probe_path.encode() in command:
                docker("exec", CONTAINER, "kill", str(probe_pid), check=False)
        docker("exec", CONTAINER, "rm", "-f", check_path, probe_path, pid_path, log_path, check=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with sqlite3.connect(f"{DB.as_uri()}?mode=ro", uri=True) as conn:
        old = conn.execute("SELECT value FROM settings WHERE key = ?", ("xrayTemplateConfig",)).fetchone()[0]
    template = json.loads(old)
    if "xraySetting" in template:
        raise RuntimeError("Wrapped template requires explicit migration; no changes made.")
    candidate = json.dumps(patched(template), ensure_ascii=False, separators=(",", ":"))
    fingerprint = hashlib.sha256(old.encode()).hexdigest()
    current = runtime()
    if not args.apply:
        test_route(current)
        PLAN.write_text(json.dumps({"template_sha256": fingerprint}), encoding="utf-8")
        print("Prepared one WireGuard TCP route: 192.168.5.110:443 -> internal nginx. No live settings changed.")
        return
    if not PLAN.exists() or json.loads(PLAN.read_text())["template_sha256"] != fingerprint:
        raise RuntimeError("Settings changed since preparation; prepare again to preserve concurrent edits.")
    test_route(current)
    backup = DB.with_name(f"x-ui.before-codex-route-{time.strftime('%Y%m%d-%H%M%S')}.db")
    with sqlite3.connect(DB) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    with sqlite3.connect(DB, timeout=15) as conn:
        conn.execute("BEGIN IMMEDIATE")
        updated = conn.execute("UPDATE settings SET value = ? WHERE key = ? AND value = ?",
                               (candidate, "xrayTemplateConfig", old))
        if updated.rowcount != 1:
            raise RuntimeError("Concurrent change detected; no live setting replaced.")
    try:
        docker("restart", CONTAINER)
        for attempt in range(20):
            time.sleep(0.5)
            try:
                loaded = runtime()
            except (RuntimeError, json.JSONDecodeError):
                continue
            if PATCH["outbound"] in loaded.get("outbounds", []) and PATCH["rule"] in loaded.get("routing", {}).get("rules", []):
                break
        else:
            raise RuntimeError("The panel did not load the requested route.")
        if loaded["inbounds"] != current["inbounds"]:
            raise RuntimeError("Inbound configuration changed; rolling back the route setting.")
    except Exception:
        with sqlite3.connect(DB, timeout=15) as conn:
            changed = conn.execute("UPDATE settings SET value = ? WHERE key = ? AND value = ?",
                                   (old, "xrayTemplateConfig", candidate))
            if changed.rowcount != 1:
                raise RuntimeError("Concurrent settings edit detected; automatic rollback stopped to preserve it.")
        docker("restart", CONTAINER)
        raise
    print(f"Applied and verified. Inbounds unchanged. Backup: {backup.name}")


if __name__ == "__main__":
    main()
