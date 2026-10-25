#!/usr/bin/env python3
"""Inventory an Android package without executing or extracting its contents.

This is a preparation gate, not an APK-to-browser converter. Keep APKs and
reports in scratch-android; verify publisher/signature before reuse.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def inspect(apk: Path) -> dict:
    with apk.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    with zipfile.ZipFile(apk) as archive:
        entries = archive.infolist()
        if len(entries) > 100_000:
            raise ValueError("Unexpected package size: too many entries")
        names = [entry.filename for entry in entries if not entry.is_dir()]
        nested = [name for name in names if name.lower().endswith(".apk")]
        web = [name for name in names if name.startswith(("assets/", "res/raw/"))
               and name.lower().endswith((".html", ".js", ".css", ".bundle", ".wasm"))]
        dex = [name for name in names if name.endswith(".dex")]
        # Compose/native code cannot be patched into an Electron webview.
        compose = False
        for entry in entries:
            if entry.filename in dex and entry.file_size <= 64 * 1024 * 1024:
                compose |= b"Landroidx/compose/" in archive.read(entry)
        return {
            "file": apk.name, "sha256": digest, "bytes": apk.stat().st_size,
            "signatureVerified": False, "packageIdentityVerified": False,
            "manifestPresent": "AndroidManifest.xml" in names,
            "nestedPackages": nested, "dexFiles": dex,
            "composeMarkers": compose, "webCandidates": web,
            "automaticWebImport": False,
            "nextStep": "Verify publisher, package identity, version and signing certificate; inspect candidate assets and their native bridge before creating any patches.",
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.apk.resolve(strict=True))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Never silently overwrite an earlier provenance report.
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"Inventory saved: {args.output}; web candidates: {len(report['webCandidates'])}")


if __name__ == "__main__":
    main()
