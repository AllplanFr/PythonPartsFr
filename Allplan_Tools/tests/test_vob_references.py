from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from copy import deepcopy

from application.core.allplan.paths import AllplanPaths
from application.core.configuration import SettingsStore
from application.plugins.vob_editor.allplan import VobEditorAllplanDatas
from application.plugins.vob_editor.application import VobEditorApp


class VobReferenceTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / "objekt.000"
        provider = VobEditorAllplanDatas(AllplanPaths(
            "2026", "FRA", paths={"STD": self.root, "ETC": self.root},
        ))
        self.app = VobEditorApp(
            self.root / "data", allplan_datas=provider,
            settings_store=SettingsStore(self.root / "settings.json"),
        )
        self.addCleanup(self.app._close)

    def load(self):
        reply = self.app.call("reference.load", {"lang": "fr"})
        self.assertTrue(reply["ok"], reply)
        data = reply["data"]
        self.assertEqual(set(data), {
            "referenceContract", "trades", "objects", "methods", "units", "metadata",
        })
        self.assertEqual(data["referenceContract"], "vob-references/2")
        for key in ("trades", "methods", "units"):
            self.assertEqual(data[key], [])
            metadata = data["metadata"][key]
            self.assertEqual(metadata["status"], "unavailable")
            self.assertTrue(metadata["diagnostics"])
        return data

    def test_occurrences_exact_codes_and_ambiguities(self):
        content = (
            "35.0 PFAD STEU OBJNR OBJEKT-NAME\r\n"
            "95 -----------------------------------------\r\n"
            + "".join(
                f"{1:5} {0:5} {code:>5} {name}\r\n"
                for code, name in (
                    ("00112", "First"), ("112", "Floor Level"),
                    ("112", "Floor Level"), ("112", "Geschossebene"),
                )
            )
        )
        self.source.write_bytes(content.encode("utf-16"))
        before = self.source.read_bytes()
        self.app._current_document = {
            "file": None, "header": [],
            "rules": [{
                "trade": "unknown", "object": "00112", "unit": "-1",
                "method": "-1", "formula": "", "comment": "",
            }],
        }
        document_before = deepcopy(self.app._current_document)
        data = self.load()
        self.assertEqual(data["objects"], [
            {"num": "00112", "name": "First"},
            {"num": "112", "name": "Floor Level"},
            {"num": "112", "name": "Floor Level"},
            {"num": "112", "name": "Geschossebene"},
        ])
        metadata = data["metadata"]["objects"]
        self.assertEqual(metadata["status"], "available_with_diagnostics")
        ambiguous = next(d for d in metadata["diagnostics"]
                         if d["code"] == "reference_id_ambiguous")
        self.assertEqual(ambiguous["id"], "112")
        self.assertEqual([p["line"] for p in ambiguous["locations"]], [3, 4, 5, 6])
        self.assertTrue(any(d["code"] == "objects_numeric_collision"
                            for d in metadata["diagnostics"]))
        self.assertFalse(any(o["num"] == "-1" for o in data["objects"]))
        self.assertFalse(any(o["num"] == "unknown" for o in data["objects"]))
        self.assertEqual(before, self.source.read_bytes())
        self.assertEqual(document_before, self.app._current_document)
        self.assertFalse((self.root / "settings.json").exists())

    def test_missing_file_is_explicitly_unavailable(self):
        data = self.load()
        metadata = data["metadata"]["objects"]
        self.assertEqual(data["objects"], [])
        self.assertEqual(metadata["status"], "unavailable")
        self.assertEqual(metadata["diagnostics"][0]["code"], "file_missing")
        self.assertEqual(metadata["sources"][0]["path"], str(self.source))

    def test_unreadable_format_is_not_available(self):
        self.source.write_bytes(b"not an objects file")
        data = self.load()
        self.assertEqual(data["objects"], [])
        self.assertEqual(data["metadata"]["objects"]["status"], "unavailable")
        self.assertTrue(any(d["code"] == "objects_format_unsupported"
                            for d in data["metadata"]["objects"]["diagnostics"]))

    def test_access_denied_is_explicitly_unavailable(self):
        with patch.object(Path, "read_bytes", side_effect=PermissionError("denied")):
            data = self.load()
        self.assertEqual(data["objects"], [])
        metadata = data["metadata"]["objects"]
        self.assertEqual(metadata["status"], "unavailable")
        self.assertEqual(metadata["diagnostics"][0]["code"], "file_access")
        self.assertEqual(metadata["diagnostics"][0]["locations"], [
            {"path": str(self.source), "line": None},
        ])


if __name__ == "__main__":
    unittest.main()
