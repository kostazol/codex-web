"""Offline inventory checks; optional signed-fixture checks never execute the APK."""
import importlib.util
import io
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

spec = importlib.util.spec_from_file_location(
    "audit", Path(__file__).resolve().parents[1] / "scripts/inspect_android.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def package(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return data.getvalue()


class InventoryTests(unittest.TestCase):
    def inspect_bytes(self, content):
        with tempfile.TemporaryDirectory() as folder:
            apk = Path(folder, "test.apk")
            apk.write_bytes(content)
            return audit.inspect(apk)

    def test_native_markers_do_not_claim_verified_or_web_importable(self):
        result = self.inspect_bytes(package([
            ("classes.dex", b"Landroidx/compose/ui\0CodexRemoteHostChip\0"),
            ("assets/latex.html", b"<html></html>"),
            ("AndroidManifest.xml", b"untrusted manifest"),
        ]))
        self.assertTrue(result["composeMarkers"])
        self.assertEqual(result["remoteComponentMarkers"], ["CodexRemoteHostChip"])
        self.assertEqual(result["webCandidates"], ["assets/latex.html"])
        self.assertFalse(result["signatureVerified"])
        self.assertFalse(result["packageIdentityVerified"])
        self.assertFalse(result["automaticWebImport"])

    def test_nested_packages_remain_unverified_without_verifier(self):
        result = self.inspect_bytes(package([
            ("base.apk", package([("AndroidManifest.xml", b"manifest")])),
        ]))
        self.assertEqual(len(result["packages"]), 1)
        self.assertFalse(result["packageIdentityVerified"])
        self.assertFalse(result["consistentSplitVersions"])

    def test_path_traversal_rejected(self):
        with self.assertRaisesRegex(ValueError, "flat filename"):
            self.inspect_bytes(package([("../outside.apk", b"data")]))

    def test_duplicate_entries_rejected(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            data = package([("classes.dex", b"a"), ("classes.dex", b"b")])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.inspect_bytes(data)

    def test_recursive_apk_rejected(self):
        data = package([("base.apk", package([("another.apk", b"data")]))])
        with self.assertRaisesRegex(ValueError, "Recursively"):
            self.inspect_bytes(data)

    def test_unknown_verifier_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            jar = Path(folder, "unknown.jar")
            jar.write_bytes(b"untrusted tool")
            with self.assertRaisesRegex(ValueError, "pinned Google"):
                audit.verify(Path("unused.apk"), jar, "must-not-execute")

    def test_upstream_comparison_includes_split_contents(self):
        old = {"sha256": "old", "packages": [{"remoteComponentMarkers": ["Old"], "webCandidates": []}]}
        new = {"sha256": "new", "packages": [{"remoteComponentMarkers": ["New"], "webCandidates": ["assets/new.html"]}]}
        delta = audit.compare(new, old)
        self.assertTrue(delta["requiresUiReview"])
        self.assertEqual(delta["remoteComponentMarkers"], {"added": ["New"], "removed": ["Old"]})
        self.assertEqual(delta["webCandidates"]["added"], ["assets/new.html"])

    @unittest.skipUnless(os.environ.get("ANDROID_TEST_APK") and os.environ.get("APKSIG_JAR"),
                         "Provide a signed local APK and the pinned verifier for integration checks")
    def test_signed_fixture_tampering_and_wrong_publisher(self):
        apk = Path(os.environ["ANDROID_TEST_APK"]).resolve()
        jar = Path(os.environ["APKSIG_JAR"]).resolve()
        self.assertTrue(audit.verify(apk, jar, "java")["packageIdentityVerified"])
        with patch.object(audit, "CERTIFICATE", "00" * 32):
            self.assertFalse(audit.verify(apk, jar, "java")["signatureVerified"])
        with tempfile.TemporaryDirectory() as folder:
            damaged = Path(folder, "damaged.apk")
            data = bytearray(apk.read_bytes())
            with zipfile.ZipFile(apk) as archive:
                entry = next(e for e in archive.infolist()
                             if e.filename != "AndroidManifest.xml" and e.compress_size > 8)
            name_size, extra_size = struct.unpack_from("<HH", data, entry.header_offset + 26)
            data[entry.header_offset + 30 + name_size + extra_size + 4] ^= 1
            damaged.write_bytes(data)
            self.assertFalse(audit.verify(damaged, jar, "java")["signatureVerified"])


if __name__ == "__main__":
    unittest.main()
