import hashlib
import json
import io
import logging
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import zipfile

from application.core.catalog import PLUGINS
from application.core.context import LaunchContext
from application.launcher import aim_local_delivery as local
from application.launcher import aim_remote_review as host
from application.launcher.main import create_parser, run_app


class LocalDeliveryTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = patch.dict(os.environ, {"LOCALAPPDATA": str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.archive = self.root / "aim.zip"
        script = ("presentation_contract presentation_capabilities "
                  "aim-organized-presentation " + " ".join(local.COMMANDS)).encode()
        self.contents = {
            "document.html": b"<html>synthetic</html>",
            "assets/information-manager-test.js": script,
            "build-manifest.json": json.dumps({
                "schema": "build-identity/1", "revision": local.REVISION,
                "trackedChangesAtBuild": False,
                "files": [{"file": "/assets/information-manager-test.js",
                           "sha256": hashlib.sha256(script).hexdigest()}],
            }).encode(),
        }

    def package(self, *, changed=False, extra=None, tree=local.TREE, images=None,
                revision=local.REVISION):
        build = json.loads(self.contents["build-manifest.json"])
        build["revision"] = revision
        self.contents["build-manifest.json"] = json.dumps(build).encode()
        manifest = {
            "schema": "aim-local-recipe/1", "revision": revision, "tree": tree,
            "files": [{"file": name, "bytes": len(body),
                       "sha256": hashlib.sha256(body).hexdigest()}
                      for name, body in self.contents.items()],
        }
        if images is not None:
            manifest["localImages"] = images
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("artifact-manifest.json", json.dumps(manifest))
            for name, body in self.contents.items():
                archive.writestr(name, b"changed" if changed and name == "document.html" else body)
            if extra:
                archive.writestr(extra, b"not allowed")
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def install(self, digest):
        descriptor = local.installation_file()
        descriptor.parent.mkdir(parents=True, exist_ok=True)
        descriptor.write_text(json.dumps({
            "schema": "aim-local-installation/1", "revision": local.REVISION,
            "tree": local.TREE, "sha256": digest, "pythonState": local.PYTHON_STATE,
            "artifact": str(self.archive),
        }), encoding="utf-8")

    def test_latest_revision_uses_its_own_tree_and_python_pin(self):
        digest = self.package(tree=local.WORKING_TREE, revision=local.WORKING_REVISION)
        with patch.object(local, "WORKING_ARTIFACT_SHA256", digest):
            descriptor = local.installation_file()
            descriptor.parent.mkdir(parents=True, exist_ok=True)
            descriptor.write_text(json.dumps({
                "schema": "aim-local-installation/1",
                "revision": local.WORKING_REVISION,
                "tree": local.WORKING_TREE,
                "sha256": digest,
                "pythonState": local.WORKING_PYTHON_STATE,
                "artifact": str(self.archive),
            }), encoding="utf-8")
            manifest, resources = local.installed_resources()
        self.assertEqual(manifest["revision"], local.WORKING_REVISION)
        self.assertIn(local.ROUTE, resources)

    def test_exact_local_resources_and_no_public_fetch(self):
        digest = self.package()
        with patch.object(local, "ARTIFACT_SHA256", digest), patch.object(
            host, "fetch_public", side_effect=AssertionError("network"),
        ):
            manifest, resources = local.local_resources(self.archive, digest)
        self.assertEqual(manifest["revision"], local.REVISION)
        self.assertEqual(set(resources), {local.ROUTE, local.ORIGIN + "/assets/information-manager-test.js"})

    def test_internal_integrity_tree_and_extra_entries_fail_closed(self):
        for kwargs in ({"changed": True}, {"tree": "0" * 40},
                       {"extra": "extra.js"}, {"extra": "../private.js"},
                       {"extra": "DOCUMENT.HTML"}):
            with self.subTest(kwargs=kwargs):
                digest = self.package(**kwargs)
                with patch.object(local, "ARTIFACT_SHA256", digest):
                    with self.assertRaises(ValueError):
                        local.local_resources(self.archive, digest)

    def test_outer_digest_revision_and_limit_are_checked(self):
        digest = self.package()
        with self.assertRaises(ValueError):
            local.local_resources(self.archive, "0" * 64)
        with self.assertRaises(ValueError):
            local.local_resources(self.archive, digest, "other")
        with patch.object(local, "LIMIT", 1):
            with self.assertRaises(ValueError):
                local.local_resources(self.archive)

    def test_unsafe_asset_urls_and_wrong_asset_hash_are_refused(self):
        original = self.contents["build-manifest.json"]
        for path in ("/assets/../private.js", "https://elsewhere.invalid/test.js",
                     "/assets/information-manager-test.js"):
            build = json.loads(original)
            build["files"][0]["file"] = path
            build["files"][0]["sha256"] = "0" * 64
            self.contents["build-manifest.json"] = json.dumps(build).encode()
            digest = self.package()
            with patch.object(local, "ARTIFACT_SHA256", digest):
                with self.assertRaises(ValueError):
                    local.local_resources(self.archive, digest)

    def test_only_exact_manifested_local_images_can_be_served(self):
        images = {
            "assets/icon.png": b"\x89PNG\r\n\x1a\nsynthetic",
            "assets/icon.svg": b'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
        }
        build = json.loads(self.contents["build-manifest.json"])
        for name, body in images.items():
            self.contents[name] = body
            build["files"].append({"file": "/" + name, "sha256": hashlib.sha256(body).hexdigest()})
        self.contents["build-manifest.json"] = json.dumps(build).encode()
        digest = self.package()
        with patch.object(local, "ARTIFACT_SHA256", digest):
            _, resources = local.local_resources(self.archive, digest)
        self.assertEqual(resources[local.ORIGIN + "/assets/icon.png"], ("image/png", images["assets/icon.png"]))
        self.assertEqual(resources[local.ORIGIN + "/assets/icon.svg"][0], "image/svg+xml")
        self.assertNotIn(local.ORIGIN + "/assets/icon.svg?x=1", resources)
        self.assertNotIn(local.ORIGIN + "/__l5e/assets-v1/icon.svg", resources)
        self.contents["assets/icon.png"] = b"changed"
        digest = self.package()
        with patch.object(local, "ARTIFACT_SHA256", digest):
            with self.assertRaises(ValueError):
                local.local_resources(self.archive, digest)

    def test_active_or_external_svg_and_bad_image_types_are_refused(self):
        for body in (
            b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><use href="https://elsewhere.invalid/a"/></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import "x";</style></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"><style>p{fill:url(x)}</style></svg>',
            b'<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
            b'<svg>',
        ):
            with self.subTest(body=body):
                with self.assertRaises(ValueError):
                    local.resource_mime("/assets/icon.svg", body)
        for name, body in (("/assets/icon.png", b"not png"), ("/assets/icon.html", b"<html/>")):
            with self.assertRaises(ValueError):
                local.resource_mime(name, body)

    def test_pinned_local_manager_image_is_served_without_changing_build_identity(self):
        name = "assets/folder_prj-B99bYo91.png"
        self.contents[name] = b"\x89PNG\r\n\x1a\nsynthetic"
        original_build = self.contents["build-manifest.json"]
        digest = self.package(images=[name])
        with patch.object(local, "ARTIFACT_SHA256", digest):
            _, resources = local.local_resources(self.archive, digest)
        self.assertEqual(resources[local.ORIGIN + "/" + name],
                         ("image/png", self.contents[name]))
        self.assertEqual(self.contents["build-manifest.json"], original_build)
        for images in ([name, name], ["assets/unreviewed.png"],
                       ["https://example.invalid/icon.png"], [False], name):
            with self.subTest(images=images):
                digest = self.package(images=images)
                with patch.object(local, "ARTIFACT_SHA256", digest):
                    with self.assertRaises(ValueError):
                        local.local_resources(self.archive, digest)
        for changed in (True, False):
            self.contents[name] = b"not a PNG"
            digest = self.package(images=[name], changed=changed)
            with patch.object(local, "ARTIFACT_SHA256", digest):
                with self.assertRaises(ValueError):
                    local.local_resources(self.archive, digest)
        del self.contents[name]
        digest = self.package(images=[name])
        with patch.object(local, "ARTIFACT_SHA256", digest):
            with self.assertRaisesRegex(ValueError, "absente"):
                local.local_resources(self.archive, digest)

    def test_installed_descriptor_and_python_are_required_before_resources(self):
        with self.assertRaisesRegex(RuntimeError, "lancement distant bloque"):
            local.installed_resources()
        digest = self.package()
        self.install(digest)
        with self.assertRaisesRegex(ValueError, "incompatible"):
            local.installed_resources()
        with patch.object(local, "ARTIFACT_SHA256", digest), patch.object(
            local, "verify_python", side_effect=ValueError("Python changed"),
        ), patch.object(local, "local_resources") as load:
            with self.assertRaisesRegex(ValueError, "Python changed"):
                local.installed_resources()
        load.assert_not_called()

    def test_python_pin_is_independent_of_session_directory(self):
        with patch("application.launcher.aim_local_delivery.PACKAGE_ROOT", self.root), patch.object(
            local, "PYTHON_FILES", {"service.py": hashlib.sha256(b"exact").hexdigest()},
        ):
            (self.root / "service.py").write_bytes(b"exact")
            local.verify_python()
            (self.root / "service.py").write_bytes(b"other")
            with self.assertRaisesRegex(ValueError, "Etat Python"):
                local.verify_python()

    def test_manager_uses_real_service_and_existing_context_only_when_installed(self):
        context = LaunchContext(allplan_version="2027", allplan_language="fra")
        webview = MagicMock()
        with patch.dict("sys.modules", {"webview": webview}), patch.object(
            local, "installed_resources", return_value=({"revision": local.REVISION}, {}),
        ), patch("application.launcher.aim_local_delivery.run_protected") as protected:
            run_app(PLUGINS["information_manager"], context, create_parser().parse_args([]))
        app, workspace, manifest, _ = protected.call_args.args
        self.assertEqual(app._launch_context, context)
        self.assertTrue(app._requires_protected_host)
        self.assertEqual(app.get_app_info()["capabilities"], ["project.select"])
        self.assertTrue(app.get_app_info()["read_only"])
        self.assertEqual(workspace.name, "standard")
        self.assertEqual(workspace.parent.name, "2027")
        self.assertEqual(manifest["revision"], local.REVISION)
        webview.create_window.assert_not_called()
        webview.start.assert_not_called()

    def test_manager_blocks_before_window_when_installation_absent(self):
        webview = MagicMock()
        with patch.dict("sys.modules", {"webview": webview}):
            with self.assertRaisesRegex(RuntimeError, "lancement distant bloque"):
                run_app(PLUGINS["information_manager"], LaunchContext(),
                        create_parser().parse_args([]))
        webview.create_window.assert_not_called()
        webview.start.assert_not_called()

    def test_manager_rejects_bad_delivery_without_remote_fallback(self):
        self.install("0" * 64)
        webview = MagicMock()
        with patch.dict("sys.modules", {"webview": webview}), patch.object(
            host, "published_resources", side_effect=AssertionError("remote fallback"),
        ):
            with self.assertRaisesRegex(ValueError, "incompatible"):
                run_app(PLUGINS["information_manager"], LaunchContext(),
                        create_parser().parse_args([]))
        webview.create_window.assert_not_called()

    def test_persistent_host_has_same_boundary_api_tls_and_no_initial_project_constraint(self):
        app = MagicMock()
        webview = MagicMock()
        webview.settings = {"IGNORE_SSL_ERRORS": True}
        window = webview.create_window.return_value
        window.gui.renderer = "edgechromium"
        window.get_current_url.return_value = host.ROUTE
        window._functions = {"get_app_info": None, "get_initial_data": None, "call": None}
        window.native.Invoke.side_effect = lambda action: action()
        task = window.native.webview.CoreWebView2.CallDevToolsProtocolMethodAsync.return_value
        task.IsCompleted = True
        webview.start.side_effect = lambda prepare, **kwargs: prepare()
        resources = {host.ROUTE: ("text/html", b"<html>synthetic</html>")}
        with patch.dict("sys.modules", {
            "webview": webview, "System": SimpleNamespace(Action=lambda callback: callback),
        }        ), patch("application.launcher.protocol_control.load_native") as native, patch(
            "application.launcher.aim_remote_review.Event",
        ) as event, patch.object(host, "PublishedBoundary") as boundary, patch(
            "builtins.print",
        ) as output, patch("application.core.logging_setup.configure_logging"):
            event.return_value.wait.return_value = True
            event.return_value.is_set.return_value = False
            host.run_protected(app, self.root, {"revision": "unreviewed-local"}, resources)
        output.assert_not_called()
        app._set_presentation_update.assert_called_once_with(False)
        app.get_initial_data.assert_not_called()
        app._attach_window.assert_called_once_with(window)
        self.assertIsNone(webview.create_window.call_args.kwargs["js_api"])
        self.assertEqual(len(window.expose.call_args.args), 3)
        self.assertFalse(webview.settings["IGNORE_SSL_ERRORS"])
        self.assertTrue(webview.start.call_args.kwargs["private_mode"])
        self.assertFalse(webview.start.call_args.kwargs["debug"])
        boundary.return_value.install.assert_called_once()
        self.assertIs(boundary.call_args.args[0], resources)
        self.assertEqual(boundary.call_args.args[2], native.return_value.ResourceContext)
        window.evaluate_js.assert_not_called()
        self.assertEqual(resources, {})
        self.assertEqual(Path(webview.start.call_args.kwargs["storage_path"]).parent.name, "profiles")
        self.assertNotEqual(Path(webview.start.call_args.kwargs["storage_path"]), self.root / "profile")

    def test_native_window_failure_is_explicit_before_api_attachment(self):
        app = MagicMock()
        webview = MagicMock()
        webview.create_window.return_value = None
        with patch.dict("sys.modules", {
            "webview": webview, "System": SimpleNamespace(Action=lambda callback: callback),
        }), patch("application.launcher.protocol_control.load_native"), patch(
            "application.core.logging_setup.configure_logging",
        ):
            with self.assertRaisesRegex(RuntimeError, "fenetre AIM"):
                host.run_protected(app, self.root, {"revision": local.REVISION}, {})
        app._attach_window.assert_not_called()
        webview.start.assert_not_called()

    def test_verified_frontend_revision_selects_only_compatible_capabilities(self):
        from application.plugins.information_manager.presentation import AimPresentationApp
        from application.plugins.information_manager.presentation_import import COMMANDS
        for revision, expected, tree in (
            ("0c62e46d5699c24c553e4ce6a667315f524180a5", list(COMMANDS), 0),
            ("2bd4fbbad1f9d8c2a86db515377bfb32778395de",
             [*COMMANDS, "presentation.update"], 0),
            ("05427002aaa64bd20f72ba27afc7586cd5b177fa",
             [*COMMANDS, "presentation.update"], 1),
            ("0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
             [*COMMANDS, "presentation.update"], 1),
            ("04eda2a7123fc633839799d9f2f17f56d6238c79", list(COMMANDS), 0),
            ("5b25d31e26146304f94dc03d86e61a68e533cf87", list(COMMANDS), 0),
            ("unknown", list(COMMANDS), 0),
        ):
            app = AimPresentationApp(self.root, LaunchContext())
            webview = MagicMock()
            with patch.dict("sys.modules", {
                "webview": webview, "System": SimpleNamespace(Action=lambda callback: callback),
            }), patch("application.launcher.protocol_control.load_native"), \
                    patch("application.core.logging_setup.configure_logging"):
                host.run_protected(app, self.root, {"revision": revision}, {})
            self.assertEqual(app.get_app_info()["presentation_capabilities"], expected)
            self.assertEqual(app.get_app_info()["presentation_tree_contract"], tree)
            info = app.get_app_info()
            self.assertEqual(info.get("project_manager_menu_contract"),
                             1 if revision == "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
                             else None)
            self.assertEqual(info.get("working_state_contract"),
                             1 if revision == "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65" else None)
            self.assertEqual(info["read_only"],
                             revision != "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65")
            if "presentation.update" in expected:
                self.assertEqual(app.call("presentation.update", {})["error"]["code"],
                                 "invalid_payload")
            else:
                self.assertEqual(app.call("presentation.update", {})["error"]["code"],
                                 "unknown_command")

    def test_manager_menu_requires_separate_reviewed_frontend_profile(self):
        from application.plugins.information_manager.presentation import AimPresentationApp
        reviewed = "b00bb3bcda3b491d79188a39c34034d49b23e5bd"
        color_reviewed = "55c7fd90966bb19978b0c24b91fc153994c96e28"
        latest = "0a89f8150ec881d0bdb204e53841d0742643c2d3"
        working = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
        self.assertEqual(host.MANAGER_MENU_FRONTENDS,
                         frozenset({reviewed, color_reviewed, latest, working}))
        for revision, available in (
            (reviewed, True),
            (color_reviewed, True),
            (latest, True),
            (working, True),
            ("b00bb3b", False),
            ("05427002aaa64bd20f72ba27afc7586cd5b177fa", False),
            ("unreviewed", False),
        ):
            app = AimPresentationApp(self.root, LaunchContext())
            with patch.dict("sys.modules", {
                "webview": MagicMock(), "System": SimpleNamespace(Action=lambda callback: callback),
            }), patch("application.launcher.protocol_control.load_native"), \
                    patch("application.core.logging_setup.configure_logging"):
                host.run_protected(app, self.root, {"revision": revision}, {})
            info = app.get_app_info()
            self.assertEqual(info.get("project_manager_menu_contract"), 1 if available else None)
            self.assertEqual(info.get("project_manager_assignment_contract"),
                             1 if revision == working else None)
            self.assertEqual(info.get("working_state_contract"),
                             1 if revision == working else None)
            reply = app.call("project.manager.favorites.list", {})
            if available:
                self.assertEqual(reply, {"ok": True, "paths": []})
                self.assertEqual(info["presentation_tree_contract"], 1)
                self.assertEqual(info["project_history_contract"], 1)
                self.assertIn("presentation.update", info["presentation_capabilities"])
                self.assertEqual(info["read_only"], revision != working)
            else:
                self.assertEqual(reply["error"]["code"], "unknown_command")

    def test_preview_color_requires_separate_reviewed_frontend_profile(self):
        from application.plugins.information_manager.presentation import AimPresentationApp
        reviewed = "55c7fd90966bb19978b0c24b91fc153994c96e28"
        latest = "0a89f8150ec881d0bdb204e53841d0742643c2d3"
        working = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
        self.assertEqual(host.PREVIEW_COLOR_FRONTENDS, frozenset({reviewed, latest, working}))
        pending = "a45460f0a49e18185eac3f4672e6cf8eacf9ba4b"
        for revision, available in (
            (reviewed, True),
            (latest, True),
            (working, True),
            ("0a89f81", False),
            ("55c7fd9", False),
            (pending, False),
            ("b00bb3bcda3b491d79188a39c34034d49b23e5bd", False),
            ("05427002aaa64bd20f72ba27afc7586cd5b177fa", False),
        ):
            app = AimPresentationApp(self.root, LaunchContext())
            with patch.dict("sys.modules", {
                "webview": MagicMock(), "System": SimpleNamespace(Action=lambda callback: callback),
            }), patch("application.launcher.protocol_control.load_native"), \
                    patch("application.core.logging_setup.configure_logging"):
                host.run_protected(app, self.root, {"revision": revision}, {})
            info = app.get_app_info()
            self.assertEqual(info.get("project_manager_preview_color_contract"), 1 if available else None)
            self.assertEqual(info.get("working_state_contract"),
                             1 if revision == working else None)
            self.assertEqual(info.get("project_manager_assignment_contract"),
                             1 if revision == working else None)
            self.assertEqual(info["capabilities"], ["project.select"])
            if available:
                self.assertEqual(info["presentation_tree_contract"], 1)
                self.assertEqual(info["project_history_contract"], 1)
                self.assertEqual(info["project_manager_menu_contract"], 1)
                self.assertIn("presentation.update", info["presentation_capabilities"])
                self.assertEqual(info["read_only"], revision != working)
        for invalid in (1, "true", None):
            with self.assertRaises(ValueError):
                app._set_project_manager_preview_color(invalid)

    def test_native_library_console_is_removed_but_errors_reach_file_logging(self):
        logger = logging.getLogger("pywebview")
        previous, propagate = logger.handlers[:], logger.propagate
        output = io.StringIO()
        console = logging.StreamHandler(output)
        logger.handlers = [console]
        self.addCleanup(setattr, logger, "handlers", previous)
        self.addCleanup(setattr, logger, "propagate", propagate)
        webview = MagicMock()
        webview.start.side_effect = lambda *a, **kw: logger.error("Synthetic native error")
        with patch.dict("sys.modules", {
            "webview": webview, "System": SimpleNamespace(Action=lambda callback: callback),
        }), patch("application.launcher.protocol_control.load_native"), \
                patch("application.core.logging_setup.configure_logging"), \
                self.assertLogs(level="INFO") as records:
            host.run_protected(MagicMock(), self.root, {"revision": local.REVISION}, {})
        self.assertTrue(any("Synthetic native error" in line for line in records.output))
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn(console, logger.handlers)
        self.assertTrue(logger.propagate)

    def test_persistent_host_without_recipe_observer_still_propagates_bootstrap_failure(self):
        app = MagicMock()
        webview = MagicMock()
        window = webview.create_window.return_value
        window.gui.renderer = "unsupported"
        webview.start.side_effect = lambda prepare, **kwargs: prepare()
        resources = {host.ROUTE: ("text/html", b"<html>synthetic</html>")}
        with patch.dict("sys.modules", {
            "webview": webview, "System": SimpleNamespace(Action=lambda callback: callback),
        }), patch("application.launcher.protocol_control.load_native"), patch(
            "application.launcher.aim_remote_review.Event",
        ) as event, patch("builtins.print"), patch(
            "application.core.logging_setup.configure_logging",
        ):
            event.return_value.wait.return_value = True
            event.return_value.is_set.return_value = False
            with self.assertRaisesRegex(RuntimeError, "Protected review failed"):
                host.run_protected(app, self.root, {"revision": local.REVISION}, resources)
        window.destroy.assert_called_once()
        window.expose.assert_not_called()
        self.assertEqual(resources, {})


if __name__ == "__main__":
    unittest.main()
