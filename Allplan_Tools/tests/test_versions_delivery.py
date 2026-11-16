import hashlib
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import zipfile

from allplan_tools import assemble_package, home_delivery
from application.launcher import smartcatalog_local_delivery as smart
from application.launcher import vob_local_delivery as vob


ROOT = Path(__file__).resolve().parents[1]
REVISION = "ccdaa3a932ffe23629decc2fabfeed8ac6e39935"


class VersionsDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        downloads = Path(os.environ["VERSIONS_DELIVERY_DIRECTORY"])
        cls.home = downloads / "allplan-tools-home-local-ccdaa3a.zip"
        cls.vob = downloads / "vob-editor-local-ccdaa3a.zip"
        cls.smart = downloads / "smartcatalog-local-ccdaa3a.zip"

    def test_explicit_new_and_previous_plugin_deliveries_are_accepted(self):
        for module, current, previous in (
                (vob, self.vob, "vob-editor-local-aba4fc0.zip"),
                (smart, self.smart, "smartcatalog-local-797db6f.zip")):
            with self.subTest(module=module.__name__):
                manifest, _ = module.local_resources(current)
                self.assertEqual(manifest["revision"], REVISION)
                manifest, _ = module.local_resources(current.parent / previous)
                self.assertEqual(manifest["revision"], module.REVISION)

    def test_home_inventory_verified_and_sidecar_not_served(self):
        manifest, files = home_delivery.verified_home_package(self.home)
        self.assertEqual(manifest["revision"], REVISION)
        self.assertEqual(set(files), {"home-manifest.json", *manifest["files"]})
        self.assertNotIn("SHA256SUMS.txt", files)

    def test_pinned_78977bc_home_without_sidecar_keeps_all_integrity_checks(self):
        archive = self.home.parent / "allplan-tools-home-local-78977bc.zip"
        manifest, files = home_delivery.verified_home_package(archive)
        self.assertEqual(manifest["revision"], "78977bcdaf02f3066e0c428378b6f62445c61258")
        self.assertEqual(set(files), {"home-manifest.json", *manifest["files"]})
        self.assertNotIn("SHA256SUMS.txt", files)
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256(files[name]).hexdigest(), digest)
        verify = home_delivery._verify_inventories
        bad = dict(files)
        bad["index.html"] += b"altered"
        with self.assertRaises(ValueError):
            verify(bad, "home-manifest.json", manifest["files"], require_sums=False)
        with self.assertRaises(ValueError):
            verify(dict(files, **{"extra.js": b"extra"}), "home-manifest.json",
                   manifest["files"], require_sums=False)
        with self.assertRaises(ValueError):
            verify(dict(files, **{"SHA256SUMS.txt": b"invalid"}), "home-manifest.json",
                   manifest["files"], require_sums=False)
        sums = "".join(f"{hashlib.sha256(body).hexdigest()}  {name}\n"
                       for name, body in files.items()).encode()
        verify(dict(files, **{"SHA256SUMS.txt": sums}), "home-manifest.json",
               manifest["files"], require_sums=False)
        with TemporaryDirectory() as temporary:
            altered = Path(temporary) / "home.zip"
            altered.write_bytes(archive.read_bytes() + b"altered")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                home_delivery.verified_home_package(altered)

    def test_home_bad_hash_identity_paths_and_inventories_are_rejected(self):
        with zipfile.ZipFile(self.home) as package:
            original = {i.filename: package.read(i) for i in package.infolist()
                        if not i.is_dir()}
        with TemporaryDirectory() as temporary:
            archive = Path(temporary) / "home.zip"
            archive.write_bytes(self.home.read_bytes() + b"altered")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                home_delivery.verified_home_package(archive)
            for alteration in ("identity", "resource", "sums", "path", "extra"):
                files = dict(original)
                if alteration == "identity":
                    manifest = json.loads(files["home-manifest.json"])
                    manifest["revision"] = "0" * 40
                    files["home-manifest.json"] = json.dumps(manifest).encode()
                elif alteration == "resource":
                    files["index.html"] += b"altered"
                elif alteration == "sums":
                    files["SHA256SUMS.txt"] = b"0" * 64 + b"  index.html\n"
                elif alteration == "path":
                    files["../escape"] = b"bad"
                else:
                    files["extra.js"] = b"bad"
                output = BytesIO()
                with zipfile.ZipFile(output, "w") as package:
                    for name, body in files.items():
                        package.writestr(name, body)
                archive.write_bytes(output.getvalue())
                digest = hashlib.sha256(output.getvalue()).hexdigest()
                with self.subTest(alteration=alteration), \
                        patch.dict(home_delivery.DELIVERIES, {digest: REVISION}):
                    with self.assertRaises(ValueError):
                        home_delivery.verified_home_package(archive)

    def test_assembly_selects_new_home_and_internal_plugins_with_product_versions(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "candidate"
            assemble_package.assemble(
                candidate, Path(sys.executable), root / "profile", root / "aim",
                home_local_package=self.home, vob_local_package=self.vob,
                smartcatalog_local_package=self.smart,
            )
            config = json.loads((candidate / "runtime.json").read_text())
            self.assertEqual(config["homeRevision"], REVISION)
            home = Path(config["homeDirectory"])
            self.assertEqual(home.parent, candidate)
            self.assertFalse((home / "SHA256SUMS.txt").exists())
            inventory = json.loads((candidate / "work-manifest.json").read_text())["files"]
            for name in ("home-local-package.zip", "python/vob-local-package.zip",
                         "python/smartcatalog-local-package.zip"):
                self.assertEqual(inventory[name],
                                 hashlib.sha256((candidate / name).read_bytes()).hexdigest())
            code = """
import sys, importlib.util
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'python'))
from application.core.work_identity import verify_work_copy
from application.core.product_version import ALLPLAN_TOOLS_VERSION
from application.core.catalog import PLUGINS
verify_work_copy()
assert ALLPLAN_TOOLS_VERSION == '0.1.0'
assert all(PLUGINS[p].version == '0.1.0' for p in ('information_manager','vob_editor','smartcatalog'))
spec = importlib.util.spec_from_file_location('new_home', root / 'runtime/home_host.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.HOME_REVISION == sys.argv[2]
module.verified_home(module.HOME_DIRECTORY, module.HOME_REVISION)
"""
            result = subprocess.run(
                [sys.executable, "-I", "-B", "-c", code, str(candidate), REVISION],
                capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
