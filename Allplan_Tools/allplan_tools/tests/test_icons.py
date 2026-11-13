from io import BytesIO
import json
from pathlib import Path
import struct
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from wsgiref.util import setup_testing_defaults

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(ROOT / "runtime"))
from application.core import plugin_icons
from application.core.catalog import PLUGINS
from application.core.context import LaunchContext
import home_host


class IconTests(unittest.TestCase):
    def test_exact_library_dimensions_and_copy(self):
        for directory in ("library", "template"):
            for palette in (ROOT / directory).glob("*.pyp"):
                for size in (24, 128):
                    image = palette.with_name(palette.stem + "_" + str(size) + ".png")
                    data = image.read_bytes()
                    self.assertEqual(struct.unpack(">II", data[16:24]), (size, size))
                    self.assertEqual(data[25], 6)  # RGBA, alpha preserved
                self.assertEqual(palette.with_suffix(".png").read_bytes(),
                                 palette.with_name(palette.stem + "_128.png").read_bytes())

    def test_manifest_declared_png_ico_and_fallback(self):
        for plugin in PLUGINS.values():
            path = plugin_icons.icon_path(plugin)
            self.assertEqual(path, plugin.package_dir / plugin.icon)
            ico = path.with_suffix(".ico").read_bytes()
            self.assertEqual(struct.unpack("<HHH", ico[:6]), (0, 1, 7))
            self.assertIsNone(plugin.availability())
        with TemporaryDirectory() as directory:
            absent = SimpleNamespace(package_dir=Path(directory), icon="missing.png")
            with self.assertLogs(plugin_icons.LOGGER, level="WARNING"):
                self.assertEqual(plugin_icons.icon_path(absent), plugin_icons.DEFAULT_ICON)
            (Path(directory) / "missing.png").write_bytes(b"bad")
            with self.assertLogs(plugin_icons.LOGGER, level="WARNING"):
                self.assertEqual(plugin_icons.icon_path(absent), plugin_icons.DEFAULT_ICON)

    def test_missing_optional_icon_does_not_disable_plugin_or_integrity(self):
        from dataclasses import replace
        from application.core.work_identity import verify_work_copy
        plugin = replace(PLUGINS["smartcatalog"], icon="resources\\absent.png")
        self.assertIsNone(plugin.availability())
        # Remove no real resource: simulate an unreadable optional resource only.
        original = Path.read_bytes
        target = plugin_icons.icon_path(PLUGINS["smartcatalog"])
        companion = ROOT / "library" / "SmartCatalogEditor_24.png"
        def read(path):
            if path in (target, companion):
                raise FileNotFoundError(path)
            return original(path)
        with patch.object(Path, "read_bytes", read):
            verify_work_copy()
            with self.assertLogs(plugin_icons.LOGGER, level="WARNING"):
                self.assertEqual(plugin_icons.icon_path(PLUGINS["smartcatalog"]),
                                 plugin_icons.DEFAULT_ICON)

    def test_home_urls_and_allowlisted_route(self):
        selector = Mock()
        with patch.object(home_host, "_services", return_value=(selector, PLUGINS)):
            api = home_host.HomeApi(LaunchContext(origin="allplan", allplan_version="2026"))
        for item in api.get_home_info()["plugins"]:
            self.assertEqual(item["iconUrl"], "/plugin-icons/" + item["id"] + ".png")
        fake = SimpleNamespace(settings={}, create_window=Mock(return_value=Mock()), start=Mock())
        with patch.dict(sys.modules, {"webview": fake}), patch.object(home_host, "HomeApi", return_value=api), patch.object(plugin_icons, "bind_window_icon"):
            home_host.show_home(LaunchContext(), home_host.HOME_DIRECTORY, home_host.HOME_REVISION)
        site = fake.create_window.call_args.kwargs["url"]
        def get(path):
            env = {}
            setup_testing_defaults(env)
            env.update(PATH_INFO=path, REQUEST_METHOD="GET", **{"wsgi.input": BytesIO()})
            state = {}
            def respond(status, headers, exc_info=None):
                state.update(status=status, headers=dict(headers))
            response = site(env, respond)
            try:
                body = b"".join(response)
            finally:
                if hasattr(response, "close"):
                    response.close()
            return state, body
        for plugin in PLUGINS.values():
            state, body = get("/plugin-icons/" + plugin.id + ".png")
            self.assertTrue(state["status"].startswith("200"))
            self.assertTrue(state["headers"]["Content-Type"].startswith("image/png"))
            self.assertEqual(body, plugin_icons.icon_path(plugin).read_bytes())
        for path in ("/plugin-icons/unknown.png", "/plugin-icons/..\\runtime.json.png",
                     "/runtime.json", "/C:\\Windows\\win.ini"):
            self.assertTrue(get(path)[0]["status"].startswith("404"))

    def test_aim_attachment_preserves_pinned_parent_hook(self):
        from application.plugins.information_manager.plugin import create_app
        app = create_app(ROOT / "tests" / "unused-data", LaunchContext(), {}, SimpleNamespace(timeout=15))
        window = Mock()
        with patch.object(plugin_icons, "bind_window_icon") as bind:
            # Factory imported the callable at creation; create under patch for the closure.
            app = create_app(ROOT / "tests" / "unused-data", LaunchContext(), {}, SimpleNamespace(timeout=15))
            app._attach_window(window)
            self.assertIs(app._window, window)
            bind.assert_called_once_with(window, PLUGINS["information_manager"])


if __name__ == "__main__":
    unittest.main()
