#!/usr/bin/env python3
"""Statically inventory APK/XAPK files, optionally verifying every APK signature.

This is a preparation gate, not an APK-to-browser converter. Keep APKs and
reports in scratch-android; verify publisher/signature before reuse.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
import zipfile

PACKAGE = "com.openai.chatgpt"
# Published by https://chatgpt.com/.well-known/assetlinks.json, checked 2026-10-25.
CERTIFICATE = "B24F4BFBB3CF293F938703B9D87027C1102CC36DC4FA206910E08927DB40473C"
APKSIG_SHA256 = "7ae2e5980c77d853e3513074ee7c822bbdcdcde1668889d17faa7fe8bc8aa821"
MAX_PACKAGE_BYTES = 512 * 1024 * 1024


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(apk: Path, jar: Path, java: str) -> dict:
    if sha256(jar) != APKSIG_SHA256:
        raise ValueError("Verifier JAR does not match the pinned Google apksig 9.4.1")
    process = subprocess.run([
        java, "--class-path", str(jar),
        str(Path(__file__).with_name("VerifyAndroid.java")),
        str(apk), PACKAGE, CERTIFICATE,
    ], capture_output=True, text=True, timeout=180)
    if process.returncode not in (0, 2):
        raise ValueError(f"APK verifier failed: {process.stderr[-1500:]}")
    report = json.loads(process.stdout)
    if process.returncode == 2 and report["packageIdentityVerified"]:
        raise ValueError("Inconsistent verifier result")
    return report


def inspect(apk: Path, jar: Path | None = None, java: str = "java") -> dict:
    if apk.stat().st_size > MAX_PACKAGE_BYTES:
        raise ValueError("Oversized package")
    digest = sha256(apk)
    with zipfile.ZipFile(apk) as archive:
        entries = archive.infolist()
        if len(entries) > 100_000:
            raise ValueError("Unexpected package size: too many entries")
        if sum(entry.file_size for entry in entries) > 1024 * 1024 * 1024:
            raise ValueError("Excessive uncompressed package size")
        names = [entry.filename for entry in entries if not entry.is_dir()]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entries are not accepted")
        nested = [name for name in names if name.lower().endswith(".apk")]
        if len(nested) > 32:
            raise ValueError("Unexpected split count")
        web = [name for name in names if name.startswith(("assets/", "res/raw/"))
               and name.lower().endswith((".html", ".js", ".css", ".bundle", ".wasm"))]
        dex = [name for name in names if name.endswith(".dex")]
        # Compose/native code cannot be patched into an Electron webview.
        compose = False
        components = set()
        for entry in entries:
            if entry.filename in dex and entry.file_size <= 64 * 1024 * 1024:
                data = archive.read(entry)
                compose |= b"Landroidx/compose/" in data
                components.update(x.decode("ascii") for x in re.findall(
                    rb"CodexRemote[A-Za-z0-9]{3,100}", data))
        report = {
            "file": apk.name, "sha256": digest, "bytes": apk.stat().st_size,
            "signatureVerified": False, "packageIdentityVerified": False,
            "manifestPresent": "AndroidManifest.xml" in names,
            "nestedPackages": nested, "dexFiles": dex,
            "composeMarkers": compose, "webCandidates": web,
            "remoteComponentMarkers": sorted(components),
            "automaticWebImport": False,
            "nextStep": "Verify publisher, package identity, version and signing certificate; inspect candidate assets and their native bridge before creating any patches.",
        }
        if nested:
            packages = []
            # Use an isolated local directory; never trust ZIP names as paths.
            with tempfile.TemporaryDirectory(prefix="android-audit-", dir=apk.parent) as folder:
                for name in nested:
                    if any(c in name for c in "/\\:") or name in (".", ".."):
                        raise ValueError("Nested APK name must be a flat filename")
                    entry = archive.getinfo(name)
                    if entry.file_size > MAX_PACKAGE_BYTES:
                        raise ValueError("Oversized nested APK")
                    child = Path(folder, name)
                    with archive.open(entry) as source, child.open("xb") as target:
                        shutil.copyfileobj(source, target)
                    with zipfile.ZipFile(child) as inner:
                        if any(n.lower().endswith(".apk") for n in inner.namelist()):
                            raise ValueError("Recursively nested packages are not accepted")
                    packages.append(inspect(child, jar, java))
            report["packages"] = packages
            report["signatureVerified"] = all(p["signatureVerified"] for p in packages)
            report["packageIdentityVerified"] = all(p["packageIdentityVerified"] for p in packages)
            versions = {p.get("versionCode") for p in packages}
            report["consistentSplitVersions"] = len(versions) == 1 and None not in versions
            report["packageIdentityVerified"] &= report["consistentSplitVersions"]
        elif jar:
            report.update(verify(apk, jar, java))
            report["verifier"] = {"name": "Google apksig", "version": "9.4.1", "sha256": APKSIG_SHA256}
            report["certificateSource"] = "https://chatgpt.com/.well-known/assetlinks.json"
        if report["packageIdentityVerified"]:
            report["nextStep"] = "Inspect Remote UI and bridge contracts; a valid signature does not make native screens importable as web assets."
        return report


def compare(report: dict, baseline: dict) -> dict:
    def collect(node, key):
        values = set(node.get(key, []))
        for child in node.get("packages", []):
            values.update(collect(child, key))
        return values

    changes = {"packageChanged": report["sha256"] != baseline["sha256"]}
    for field in ("remoteComponentMarkers", "webCandidates"):
        old, new = collect(baseline, field), collect(report, field)
        changes[field] = {"added": sorted(new - old), "removed": sorted(old - new)}
    changes["requiresUiReview"] = changes["packageChanged"]
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apksig-jar", type=Path, help="Pinned Google apksig 9.4.1 JAR; enables verification")
    parser.add_argument("--java", default="java", help="JDK 17+ java executable")
    parser.add_argument("--compare", type=Path, help="Previous inventory; report marker/asset changes")
    args = parser.parse_args()
    report = inspect(args.apk.resolve(strict=True),
                     args.apksig_jar.resolve(strict=True) if args.apksig_jar else None,
                     args.java)
    if args.compare:
        report["comparison"] = compare(report, json.loads(args.compare.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Never silently overwrite an earlier provenance report.
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    candidates = len(report["webCandidates"]) + sum(
        len(child["webCandidates"]) for child in report.get("packages", []))
    print(f"Inventory saved: {args.output}; web candidates: {candidates}; verified publisher/package: {report['packageIdentityVerified']}")
    if args.apksig_jar and not report["packageIdentityVerified"]:
        raise SystemExit("Signature, package identity or split versions did not pass verification")


if __name__ == "__main__":
    main()
