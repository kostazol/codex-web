#!/usr/bin/env python3
# Managed by codex-web/deploy/https/https-lan-route-watch.py.
"""Reconcile the owned HTTPS reply route after WSL/VPN networking changes."""

import os
import selectors
import signal
import subprocess
import time


ROUTE_SCRIPT = "/usr/local/sbin/codex-web-https-lan-route"
CHECK_INTERVAL = 5.0
EVENT_DEBOUNCE = 0.15
stopping = False


def stop(_signum, _frame):
    global stopping
    stopping = True


def reconcile():
    check = subprocess.run([ROUTE_SCRIPT, "--check"], capture_output=True, text=True,
                           timeout=5)
    if check.returncode == 0:
        return ""
    result = subprocess.run([ROUTE_SCRIPT], capture_output=True, text=True, timeout=35)
    output = (result.stdout + result.stderr).strip()
    if result.returncode:
        return output or f"Route repair failed with exit code {result.returncode}."
    if output:
        print(output, flush=True)
    return ""


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    # Subscribe before the initial check so a change during startup is not lost.
    monitor = subprocess.Popen(["ip", "-4", "monitor", "link", "address", "route", "rule"],
                               stdout=subprocess.PIPE, stderr=None)
    selector = selectors.DefaultSelector()
    os.set_blocking(monitor.stdout.fileno(), False)
    selector.register(monitor.stdout, selectors.EVENT_READ)
    next_check = time.monotonic()
    last_error = ""
    try:
        while not stopping:
            if monitor.poll() is not None:
                raise RuntimeError("The network change monitor exited unexpectedly.")
            now = time.monotonic()
            if now >= next_check:
                try:
                    error = reconcile()
                except subprocess.TimeoutExpired:
                    error = "Route check timed out; retrying when networking is available."
                if error and error != last_error:
                    print(error, flush=True)
                last_error = error
                next_check = time.monotonic() + CHECK_INTERVAL
            events = selector.select(timeout=max(0, min(0.5, next_check - time.monotonic())))
            if events:
                while True:
                    try:
                        data = os.read(monitor.stdout.fileno(), 65536)
                    except BlockingIOError:
                        break
                    if not data:
                        if not stopping:
                            raise RuntimeError("The network change monitor closed its output.")
                        break
                next_check = min(next_check, time.monotonic() + EVENT_DEBOUNCE)
    finally:
        selector.close()
        if monitor.poll() is None:
            monitor.terminate()
        monitor.wait(timeout=3)


if __name__ == "__main__":
    main()
