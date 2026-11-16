import hashlib
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

from application.launcher import smartcatalog_local_delivery as local
from application.launcher import vob_local_delivery as vob
from application.launcher import vob_online


ROOT = Path(__file__).resolve().parents[1]


class SmartCatalogLocalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = Path(os.environ["SMARTCATALOG_LOCAL_TEST_PACKAGE"])
        cls.vob_archive = Path(os.environ["VOB_LOCAL_TEST_PACKAGE"])

    def test_real_package_and_external_icons_are_local(self):
        with patch.object(vob_online, "published_resources", side_effect=AssertionError("network")):
            manifest, resources = local.local_resources(self.archive)
        self.assertEqual(manifest["revision"], local.REVISION)
        self.assertEqual(resources[local.ROUTE], resources[local.ORIGIN + "/index.html"])
        self.assertTrue(any(url.startswith(local.ORIGIN + "/aim-assets/") for url in resources))
        self.assertTrue(manifest["externalAssets"])
        self.assertTrue(all(url.startswith(local.ORIGIN + "/") for url in resources))
        app = Mock()
        with patch.object(local, "_run_verified") as host:
            local.run(app, ROOT, ROOT, archive=self.archive)
            self.assertEqual(app.canonical_url, local.ROUTE)
            self.assertEqual(host.call_args.kwargs["app_id"], "smartcatalog")
            self.assertIsNone(host.call_args.kwargs["coordinated_revision"])

    def test_altered_and_incompatible_packages_refused_without_network(self):
        with TemporaryDirectory() as temporary, \
                patch.object(vob_online, "published_resources") as remote, \
                patch.object(local, "_run_verified") as host:
            path = Path(temporary) / "package.zip"
            path.write_bytes(self.archive.read_bytes() + b"changed")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                local.run(Mock(), ROOT, ROOT, archive=path)
            with zipfile.ZipFile(self.archive) as source:
                files = {item.filename: source.read(item) for item in source.infolist()
                         if not item.is_dir()}
            for alteration in ("compatibility", "resource", "path", "external"):
                changed = dict(files)
                manifest = json.loads(changed["smartcatalog-manifest.json"])
                if alteration == "compatibility":
                    manifest["smartcatalogCompatibility"] = "wrong/1"
                elif alteration == "resource":
                    changed["index.html"] += b"changed"
                elif alteration == "path":
                    changed["../outside"] = b"bad"
                else:
                    first = next(iter(manifest["externalAssets"].values()))
                    first["sha256"] = "0" * 64
                changed["smartcatalog-manifest.json"] = json.dumps(manifest).encode()
                if alteration == "external":
                    changed["SHA256SUMS.txt"] = "".join(
                        f"{hashlib.sha256(body).hexdigest()}  {name}\n"
                        for name, body in changed.items() if name != "SHA256SUMS.txt"
                    ).encode()
                output = BytesIO()
                with zipfile.ZipFile(output, "w") as archive:
                    for name, body in changed.items():
                        archive.writestr(name, body)
                path.write_bytes(output.getvalue())
                with self.subTest(alteration=alteration), \
                        patch.object(local, "ARTIFACT_SHA256",
                                     hashlib.sha256(path.read_bytes()).hexdigest()):
                    with self.assertRaises(ValueError):
                        local.run(Mock(), ROOT, ROOT, archive=path)
            remote.assert_not_called()
            host.assert_not_called()

    def test_svg_clipping_is_local_only_and_api_preserves_capabilities(self):
        good = b'<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><path/></clipPath></defs><style>.x{clip-path:url(#c)}</style></svg>'
        self.assertEqual(local._resource_mime("icon.svg", good), "image/svg+xml")
        for bad in (good.replace(b"url(#c)", b"url(https://example.invalid/icon)"),
                    good.replace(b"<path/>", b"<script/>")):
            with self.assertRaises(ValueError):
                local._resource_mime("icon.svg", bad)
        app = Mock()
        app.get_app_info.return_value = {"app_id": "smartcatalog", "capabilities": ["settings.load"]}
        api = vob_online.VobProtectedApi(app, app_id="smartcatalog")
        with self.assertRaises(RuntimeError):
            api.get_app_info()
        api.active = True
        self.assertEqual(api.get_app_info()["capabilities"], ["settings.load"])
        api.call("settings.load", {"app_id": "smartcatalog"})
        app.call.assert_called_once_with("settings.load", {"app_id": "smartcatalog"})

    def test_shared_host_selects_smartcatalog_bridge_without_gui(self):
        app = Mock()
        app.script_name = "resources\\bridge.js"
        with TemporaryDirectory() as temporary, \
                patch.object(vob_online, "resource_path", wraps=vob_online.resource_path) as resource, \
                patch.object(vob_online, "load_native"), \
                patch("application.core.logging_setup.configure_logging"), \
                patch("webview.create_window", return_value=None), \
                patch("webview.start") as start, \
                patch("importlib.import_module", return_value=SimpleNamespace(Action=Mock())):
            with self.assertRaisesRegex(RuntimeError, "window"):
                vob_online._run_verified(
                    app, Path(temporary), Path(temporary), {}, route=local.ROUTE,
                    coordinated_revision=None, app_id="smartcatalog",
                )
            self.assertEqual(resource.call_args.args[0],
                             vob_online.PACKAGE_ROOT / "plugins" / "smartcatalog")
            start.assert_not_called()

    def test_both_dispatches_and_combined_assembly_are_autonomous(self):
        spec = importlib.util.spec_from_file_location(
            "smart_assembly", ROOT / "allplan_tools" / "assemble_package.py")
        assembly = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(assembly)
        with TemporaryDirectory() as temporary:
            base = Path(temporary)
            candidate = base / "candidate"
            assembly.assemble(candidate, Path(sys.executable), base / "profile", base / "pin",
                              vob_local_package=self.vob_archive,
                              smartcatalog_local_package=self.archive)
            manifest = json.loads((candidate / "work-manifest.json").read_text())["files"]
            for name in ("smartcatalog-local-package.zip", "smartcatalog-local-delivery.json",
                         "vob-local-package.zip", "vob-local-delivery.json"):
                self.assertEqual(manifest["python/" + name],
                                 hashlib.sha256((candidate / "python" / name).read_bytes()).hexdigest())
            vob.local_resources(candidate / "python" / "vob-local-package.zip")
            code = """
import sys, os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
root, archive = map(Path, sys.argv[1:])
sys.path.insert(0, str(root))
from application.launcher import main, smartcatalog_local_delivery, vob_online
from application.core.context import LaunchContext
app = Mock()
args = SimpleNamespace(timeout=15, smartcatalog_local_package=None if (root / 'smartcatalog-local-delivery.json').is_file() else archive)
plugin = SimpleNamespace(id='smartcatalog')
with patch.object(main, 'create_app', return_value=app), patch.object(main, 'plugin_options', return_value={}), patch.object(smartcatalog_local_delivery, 'run') as local, patch.object(vob_online, 'run') as remote, patch('webview.create_window') as generic:
 main._run_app(plugin, LaunchContext(allplan_version='2026'), args)
 selected = root / 'smartcatalog-local-package.zip' if args.smartcatalog_local_package is None else archive
 assert local.call_args.kwargs == {'archive': selected}
 local.side_effect = ValueError('package refused')
 try: main._run_app(plugin, LaunchContext(allplan_version='2026'), args)
 except ValueError: pass
 else: raise AssertionError('local failure masked')
 remote.assert_not_called()
 generic.assert_not_called()
if (root / 'smartcatalog-local-delivery.json').is_file():
 from application.core.work_identity import verify_work_copy
 verify_work_copy()
"""
            for root in (ROOT, candidate / "python"):
                env = dict(os.environ, LOCALAPPDATA=str(base / "profile"))
                result = subprocess.run(
                    [sys.executable, "-I", "-B", "-c", code, str(root), str(self.archive)],
                    env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
