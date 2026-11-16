from dataclasses import replace
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.core import catalog, product_version
from application.core.base import BaseApp
from application.core.bridge import BridgeApp
from application.plugins.information_manager.application import InformationManagerApp
from application.plugins.smartcatalog.application import SmartCatalogApp
from application.plugins.vob_editor.application import VobEditorApp


ROOT = Path(__file__).resolve().parents[1]
IDS = ("information_manager", "smartcatalog", "vob_editor")


class ProductVersionTests(unittest.TestCase):
    def test_reference_versions_and_overlay_metadata_agree(self):
        self.assertEqual(product_version.ALLPLAN_TOOLS_VERSION, "0.1.0")
        for app_id in IDS:
            with self.subTest(app_id=app_id):
                source = catalog.read_manifest(ROOT / "application/plugins" / app_id / "plugin.json")
                overlay = catalog.read_manifest(
                    ROOT / "allplan_tools/overlay/python/application/plugins" / app_id / "plugin.json")
                self.assertEqual(source.version, "0.1.0")
                self.assertEqual(overlay.version, source.version)

    def test_plugin_api_versions_follow_metadata_without_changing_capabilities(self):
        for app_type in (InformationManagerApp, SmartCatalogApp, VobEditorApp):
            app = app_type.__new__(app_type)
            app._allplan_version = "2026"
            app._trace = Mock()
            app._capability_data = Mock(return_value={
                "capabilities": ["settings.load"],
                "unavailable_capabilities": {"reference.load": {"code": "not-implemented"}},
            })
            app_id = app.app_id
            with self.subTest(app_id=app_id):
                self.assertEqual(app.get_app_info()["version"], "0.1.0")
                changed = replace(catalog.PLUGINS[app_id], version="2.3.4")
                with patch.dict(catalog.PLUGINS, {app_id: changed}):
                    info = app.get_app_info()
                    self.assertEqual(info["version"], "2.3.4")
                    self.assertEqual(info.get("app_id", info.get("id")), app_id)
                    if isinstance(app, BridgeApp):
                        self.assertEqual(info["bridge_version"], 1)
                        self.assertEqual(info["capabilities"], ["settings.load"])
                        self.assertEqual(info["unavailable_capabilities"],
                                         {"reference.load": {"code": "not-implemented"}})
                    else:
                        self.assertEqual(info["protocol_version"], 1)

    def test_home_transmits_suite_and_plugin_versions_from_references(self):
        spec = importlib.util.spec_from_file_location(
            "version_test_home", ROOT / "allplan_tools/runtime/home_host.py")
        home = importlib.util.module_from_spec(spec)
        config = {key: str(ROOT) for key in ("pythonRoot", "profile", "homeDirectory")}
        with patch.object(Path, "read_text", return_value=json.dumps(config)):
            spec.loader.exec_module(home)
        api = home.HomeApi.__new__(home.HomeApi)
        api._year, api._verification, api._country = "2026", False, "FRA"
        for overlay in (False, True):
            plugins = {}
            for app_id in IDS:
                root = ROOT / ("allplan_tools/overlay/python" if overlay else "")
                plugin = catalog.read_manifest(root / "application/plugins" / app_id / "plugin.json")
                plugins[app_id] = SimpleNamespace(
                    id=plugin.id, name=plugin.name, description=plugin.description,
                    version=plugin.version, lifecycle=plugin.lifecycle, availability=lambda: None,
                )
            api._plugins = plugins
            with self.subTest(overlay=overlay):
                info = api.get_home_info()
                self.assertEqual(info["version"], "0.1.0")
                self.assertEqual(info["home_launch_contract"], 1)
                self.assertEqual(info["plugin_inventory_contract"], 1)
                self.assertEqual(info["context"],
                                 {"year": "2026", "verification": False, "country": "FRA"})
                self.assertEqual({p["id"]: p["installedVersion"] for p in info["plugins"]},
                                 dict.fromkeys(IDS, "0.1.0"))
        with patch.object(product_version, "ALLPLAN_TOOLS_VERSION", "3.2.1"):
            self.assertEqual(api.get_home_info()["version"], "3.2.1")


if __name__ == "__main__":
    unittest.main()
