import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

from application.launcher import vob_local_delivery as local
from application.launcher import vob_online


ROOT = Path(__file__).resolve().parents[1]


def archive_bytes(files):
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        for name, body in files.items():
            package.writestr(name, body)
    return output.getvalue()


class VobLocalDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = Path(os.environ.get(
            "VOB_LOCAL_TEST_PACKAGE", str(ROOT / "vob-editor-local-aba4fc0.zip"),
        ))
        if not cls.archive.is_file():
            raise unittest.SkipTest("Set VOB_LOCAL_TEST_PACKAGE to the delivered ZIP.")
        cls.data = cls.archive.read_bytes()
        with zipfile.ZipFile(BytesIO(cls.data)) as package:
            cls.files = {item.filename: package.read(item) for item in package.infolist()
                         if not item.is_dir()}

    def test_delivered_package_identity_and_all_root_resources(self):
        with patch.object(vob_online, "published_resources", side_effect=AssertionError("network")):
            manifest, resources = local.local_resources(self.archive)
        self.assertEqual(hashlib.sha256(self.data).hexdigest(), local.ARTIFACT_SHA256)
        self.assertEqual(manifest["revision"], local.REVISION)
        self.assertEqual(manifest["schema"], "vob-editor-local/1")
        for name, body in self.files.items():
            self.assertEqual(resources[local.ORIGIN + "/" + name][1], body)
        self.assertEqual(resources[local.ROUTE], resources[local.ORIGIN + "/index.html"])
        self.assertEqual(resources[local.ORIGIN + "/"], resources[local.ROUTE])
        self.assertIn(local.ORIGIN + "/aim-assets/checkbox/checkbox_on.png", resources)
        self.assertTrue(all(url.startswith(local.ORIGIN + "/") for url in resources))

    def test_altered_archive_refused_without_network_or_host(self):
        with TemporaryDirectory() as temporary:
            altered = Path(temporary) / "altered.zip"
            altered.write_bytes(self.data + b"altered")
            with patch.object(vob_online, "published_resources") as remote, \
                    patch.object(local, "_run_verified") as host:
                with self.assertRaisesRegex(ValueError, "fingerprint"):
                    local.run(Mock(), Path(temporary), Path(temporary), archive=altered)
                remote.assert_not_called()
                host.assert_not_called()

    def test_incompatible_manifest_refused(self):
        for field, value in (
                ("schema", "build-identity/1"), ("appId", "information_manager"),
                ("vobEditorCompatibility", "wrong/1"),
                ("revision", "58a9c1f6047015778ccddb6fb40e98e19008b56d"),
                ("trackedChangesAtBuild", True), ("entry", "missing.html"),
                ("route", "/information-manager")):
            with self.subTest(field=field):
                files = dict(self.files)
                manifest = json.loads(files["vob-manifest.json"])
                manifest[field] = value
                files["vob-manifest.json"] = json.dumps(manifest).encode()
                with self.assertRaisesRegex(ValueError, "Incompatible"):
                    local._verified_contents(archive_bytes(files))

    def test_both_inventories_are_verified(self):
        for name in ("index.html", "vob-manifest.json", "SHA256SUMS.txt"):
            with self.subTest(name=name):
                files = dict(self.files)
                if name == "vob-manifest.json":
                    manifest = json.loads(files[name])
                    manifest["additional"] = "modified"
                    files[name] = json.dumps(manifest).encode()
                else:
                    files[name] += b"modified"
                with self.assertRaises(ValueError):
                    local._verified_contents(archive_bytes(files))
        files = dict(self.files, **{"unexpected.js": b"unexpected"})
        with self.assertRaisesRegex(ValueError, "inventory"):
            local._verified_contents(archive_bytes(files))

    def test_unsafe_windows_paths_and_collisions_are_refused(self):
        for name in ("../escape", "/absolute", "C:/absolute", "assets\\escape",
                     "assets/../escape", "assets/CON.js", "assets/name.",
                     "assets/name:stream", "INDEX.HTML", "index.html/child"):
            with self.subTest(name=name):
                files = dict(self.files)
                files[name] = b"bad"
                with self.assertRaises(ValueError):
                    local._verified_contents(archive_bytes(files))

    def test_symlinks_and_duplicate_zip_entries_are_refused(self):
        for link in (False, True):
            output = BytesIO()
            with zipfile.ZipFile(output, "w") as package:
                if link:
                    entry = zipfile.ZipInfo("link")
                    entry.create_system = 3
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    package.writestr(entry, "../outside")
                else:
                    package.writestr("asset", b"first")
                    package.writestr("ASSET", b"second")
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                local._verified_contents(output.getvalue())

    def test_local_host_uses_actual_revision_and_no_remote_provider(self):
        app = Mock()
        with patch.object(local, "_run_verified") as host, \
                patch.object(vob_online, "published_resources") as remote:
            local.run(app, ROOT, ROOT, archive=self.archive)
            self.assertEqual(app.canonical_url, local.ROUTE)
            self.assertEqual(host.call_args.kwargs, {
                "route": local.ROUTE, "coordinated_revision": local.REVISION,
                "document_urls": local.DOCUMENT_URLS,
            })
            self.assertIn(local.ORIGIN + "/index.html", host.call_args.args[3])
            remote.assert_not_called()

    def test_online_provider_and_revision_check_remain_separate(self):
        manifest = {"revision": "a" * 40}
        resources = {vob_online.ROUTE: ("text/html", b"<html></html>")}
        with patch.object(vob_online, "published_resources",
                          return_value=(manifest, resources)) as remote, \
                patch.object(vob_online, "_run_verified") as host, \
                patch.object(local, "local_resources") as offline:
            with self.assertRaisesRegex(ValueError, "revision"):
                vob_online.run(Mock(), ROOT, ROOT, coordinated_revision=local.REVISION)
            host.assert_not_called()
            app = Mock()
            vob_online.run(app, ROOT, ROOT, coordinated_revision="a" * 40)
            remote.assert_called_with(route=vob_online.ROUTE)
            host.assert_called_once_with(
                app, ROOT, ROOT, resources, route=vob_online.ROUTE,
                coordinated_revision="a" * 40,
            )
            offline.assert_not_called()

    def test_boundary_serves_local_images_and_denies_remote_navigation_and_popups(self):
        _, resources = local.local_resources(self.archive)
        environment = Mock()
        native = SimpleNamespace(MemoryStream=lambda body: body,
                                 Array={bytes: lambda body: body}, Byte=bytes)
        boundary = vob_online.VobPublishedBoundary(
            resources, environment, SimpleNamespace(Document="document"), None, [],
            Mock(), route=local.ROUTE, document_urls=local.DOCUMENT_URLS,
        )
        boundary.native = native
        for url, status in (
                (local.ROUTE, 200),
                (local.ORIGIN + "/", 200),
                (local.ORIGIN + "/index.html", 200),
                (local.ORIGIN + "/aim-assets/checkbox/checkbox_on.png", 200),
                (vob_online.ROUTE, 403),
                (local.ORIGIN + "/missing.js", 403)):
            args = SimpleNamespace(Request=SimpleNamespace(Uri=url, Method="GET"),
                                   ResourceContext=("document" if url in local.DOCUMENT_URLS
                                                    else "image"))
            boundary.request(None, args)
            self.assertEqual(environment.CreateWebResourceResponse.call_args.args[1], status)
        args = SimpleNamespace(Uri=vob_online.ROUTE, Cancel=False)
        boundary.navigation(None, args)
        self.assertTrue(args.Cancel)
        args = SimpleNamespace(Uri=local.ROUTE, Handled=False)
        boundary.popup(None, args)
        self.assertTrue(args.Handled)

    def test_assembly_copies_and_inventories_local_delivery_after_overlays(self):
        import importlib.util
        import subprocess
        import sys
        spec = importlib.util.spec_from_file_location(
            "local_vob_assembly", ROOT / "allplan_tools" / "assemble_package.py")
        assembly = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(assembly)
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate = base / "candidate"
            assembly.assemble(candidate, Path(sys.executable), base / "profile",
                              base / "pin", vob_local_package=self.archive)
            python = candidate / "python"
            inventory = json.loads((candidate / "work-manifest.json").read_text())["files"]
            for name in ("vob-local-package.zip", "vob-local-delivery.json",
                         "application/launcher/vob_local_delivery.py"):
                self.assertEqual(inventory["python/" + name],
                                 hashlib.sha256((python / name).read_bytes()).hexdigest())
            config = json.loads((python / "vob-local-delivery.json").read_text())
            self.assertEqual(config["archive"], "vob-local-package.zip")
            code = """
import sys, runpy
from pathlib import Path
from unittest.mock import patch
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
from application.launcher import main
from application.core.work_identity import verify_work_copy
verify_work_copy()
with patch.object(main, 'entrypoint', return_value=0) as entry:
    sys.argv = [str(root / 'vob_launcher.py')]
    try:
        runpy.run_path(sys.argv[0], run_name='__main__')
    except SystemExit as exc:
        assert exc.code == 0
    assert sys.argv[1:] == ['vob_editor', '--vob-local-package',
                           str(root / 'vob-local-package.zip')]
    entry.assert_called_once_with()
"""
            result = subprocess.run([sys.executable, "-I", "-B", "-c", code, str(python)],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
