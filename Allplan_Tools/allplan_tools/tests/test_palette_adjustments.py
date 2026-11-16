import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(ROOT / "pythonparts"))
from application.core.context import LaunchContext


class PaletteAdjustmentsTests(unittest.TestCase):
    def test_clean_allplan_host_with_real_adapter_and_no_business_import(self):
        code = r'''
import importlib.abc, importlib, json, os, sys, tempfile, types
from pathlib import Path
from unittest.mock import patch
root = Path(sys.argv[1])
class NoBusiness(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name.startswith(("defusedxml", "application.plugins", "application.launcher")):
            raise AssertionError("Business import in Allplan: " + name)
sys.meta_path.insert(0, NoBusiness())
sys.path.insert(0, str(root / "pythonparts"))
sys.modules["CreateElementResult"] = types.SimpleNamespace(CreateElementResult=lambda items: items)
sys.modules["NemAll_Python_AllplanSettings"] = types.SimpleNamespace(
    AllplanVersion=types.SimpleNamespace(MainReleaseName=lambda: "2026.1"),
    AllplanPaths=types.SimpleNamespace(**{
        name: (lambda: r"C:\Test") for name in (
            "GetEtcPath","GetPrgPath","GetStdPath","GetUsrPath","GetTmpPath","GetCurPrjPath")}))
from AllplanToolsTest import entry
before = dict(os.environ)
with tempfile.TemporaryDirectory() as directory:
    config = json.loads((root / "runtime.json").read_text())
    config["profile"] = directory
    with patch.object(entry, "_config", return_value=(root, config)), patch.object(entry.subprocess, "Popen") as spawn:
        for stem, target in (("AllplanToolsHome","home"),("InformationManager","information_manager"),
                             ("SmartCatalogEditor","smartcatalog"),("VOBEditor","vob_editor")):
            module = importlib.import_module("AllplanToolsTest." + stem)
            module.on_control_event(object(), 1001, None)
            command = spawn.call_args.args[0]
            assert command[command.index("--allplan-version")+1] == "2026"
            assert command[command.index("--target")+1] == target
            assert "--verification-version" not in command
            assert command[command.index("--project-path")+1] == r"C:\Test"
            assert spawn.call_args.kwargs["env"]["LOCALAPPDATA"] == directory
        assert spawn.call_count == 4
assert dict(os.environ) == before
'''
        result = subprocess.run([sys.executable, "-I", "-c", code, str(ROOT)],
                                capture_output=True, timeout=20,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))

    def test_no_installation_field_and_explicit_standard_all_callbacks(self):
        stub = SimpleNamespace(CreateElementResult=lambda items: items)
        with patch.dict(sys.modules, {"CreateElementResult": stub}):
            entry = importlib.import_module("AllplanToolsTest.entry")
        for directory in ("library", "template"):
            for path in (ROOT / directory).glob("*.pyp"):
                names = [p.findtext("Name") for p in ET.parse(path).findall(".//Parameter")]
                self.assertEqual(names, ["Launch"])
        from application.core.allplan import adapter
        for stem, target in (("AllplanToolsHome", "home"), ("InformationManager", "information_manager"),
                             ("SmartCatalogEditor", "smartcatalog"), ("VOBEditor", "vob_editor")):
            with patch.dict(sys.modules, {"CreateElementResult": stub}):
                module = importlib.import_module("AllplanToolsTest." + stem)
            with TemporaryDirectory() as directory:
                context = LaunchContext(origin="allplan", allplan_version="2026", country="FRA",
                                        project_path=Path(directory) / "Example.prj")
                config = json.loads((ROOT / "runtime.json").read_text())
                config["profile"] = directory
                before = dict(os.environ)
                with patch.dict(module.control_event.__globals__, {"_config": lambda: (ROOT, config)}), \
                        patch.dict(sys.modules, {"NemAll_Python_AllplanSettings": SimpleNamespace()}), \
                        patch.object(adapter, "context_from_allplan", return_value=(context, [])) as read, \
                        patch.object(entry.subprocess, "Popen") as spawn:
                    # No InstallationType property: new and stale palettes cannot override Standard.
                    module.on_control_event(SimpleNamespace(), 1001, None)
                    self.assertIs(read.call_args.kwargs["verification_version"], False)
                    command = spawn.call_args.args[0]
                    self.assertEqual(command[command.index("--target") + 1], target)
                    self.assertNotIn("--verification-version", command)
                    self.assertEqual(command[command.index("--allplan-version") + 1], "2026")
                    self.assertEqual(command[command.index("--country") + 1], "FRA")
                    self.assertEqual(command[command.index("--project-path") + 1], str(context.project_path))
                    self.assertEqual(spawn.call_args.kwargs["env"]["LOCALAPPDATA"], directory)
                    self.assertEqual(spawn.call_args.kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)
                self.assertEqual(dict(os.environ), before)

    def test_verification_still_supported_by_common_service(self):
        from application.core.context import context_to_arguments
        self.assertIn("--verification-version", context_to_arguments(
            LaunchContext(allplan_version="2026", verification_version=True)))

    def test_normalized_measured_occupancy_and_centering(self):
        metrics = json.loads((ROOT / "palette-normalization.json").read_text())
        for size in (24, 128):
            boxes = [item[str(size)]["outputVisibleBox"] for item in metrics.values()]
            widths = [b[2] - b[0] for b in boxes]
            heights = [b[3] - b[1] for b in boxes]
            self.assertLessEqual(max(widths) - min(widths), 2)
            self.assertLessEqual(max(heights) - min(heights), 2)
            for box in boxes:
                self.assertLessEqual(abs(box[0] + box[2] - size), 1)
                self.assertLessEqual(abs(box[1] + box[3] - size), 1)
                self.assertGreater(box[0], 0)
                self.assertGreater(box[1], 0)
            for item in metrics.values():
                source = item[str(size)]["sourceAlphaBox"]
                output = item[str(size)]["targetBox"]
                self.assertAlmostEqual((source[2] - source[0]) / (source[3] - source[1]),
                                       (output[2] - output[0]) / (output[3] - output[1]), places=5)

    def test_validated_plugin_and_home_identities_unchanged(self):
        import hashlib
        reference = json.loads((ROOT / "validated-icons-reference.json").read_text())
        for name, expected in reference["files"].items():
            if name.startswith("python/") or name.startswith("home-980fff2/"):
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), expected, name)


if __name__ == "__main__":
    unittest.main()
