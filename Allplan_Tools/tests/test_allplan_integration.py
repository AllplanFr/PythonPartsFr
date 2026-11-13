import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from application.core.allplan.paths import AllplanPaths, resolve_paths
from application.plugins.vob_editor.application import VobEditorApp
from application.plugins.vob_editor.allplan import VobEditorAllplanDatas
from application.launcher.main import create_parser, detect_allplan, main as launcher_main
from application.plugins.vob_editor.discovery import detect_allplan_versions
from application.core.configuration import SettingsStore
from test_vob_editor import FakeWindow


class AllplanIntegrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.paths = {}
        for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
            directory = self.root / name
            directory.mkdir()
            self.paths[name] = directory
        self.catalog = self.root / "catalog"
        self.catalog.mkdir()
        self.settings = SettingsStore(self.root / "settings.json")

    def app(self, version, country="FRA"):
        context = AllplanPaths(str(version), country, paths=self.paths)
        app = VobEditorApp(
            self.root / "data", settings_store=self.settings,
            allplan_datas=VobEditorAllplanDatas(context, catalog_user_path=self.catalog),
        )
        self.addCleanup(app._close)
        return app

    def call(self, app, command, payload):
        with contextlib.redirect_stdout(io.StringIO()):
            return app.call(command, payload)

    def initial(self, app):
        with contextlib.redirect_stdout(io.StringIO()):
            return app.get_initial_data()

    def write(self, path):
        path.write_bytes(b"#1#2#3#4#A\r\n")
        return path

    def test_2027_order_country_and_exact_front_schema(self):
        expected = []
        for directory in (self.catalog, self.paths["STD"], self.paths["ETC"]):
            expected.append(str(self.write(directory / "vob_FRA.dat")))
            self.write(directory / "vob_DEU.dat")
        self.write(self.paths["PRJ"] / "vob_FRA.dat")
        app = self.app(2027)
        data = self.initial(app)
        self.assertEqual([item["path"] for item in data["files"]], expected)
        self.assertTrue(all(
            {"id", "name", "path", "version", "source"} <= set(item)
            for item in data["files"]
        ))
        self.assertEqual(data["context"]["version"], "2027")
        self.assertEqual(data["context"]["versions"], ["2027"])
        self.assertEqual(data["allplan"]["country"], "FRA")
        self.assertFalse(data["truncated"])
        self.assertEqual(data["warnings"], [])
        self.assertEqual(app.get_app_info()["allplan_version"], "2027")

    def test_historical_listing_is_nonrecursive_and_allows_vo_names(self):
        for name in ("vo2.FRA", "volume", "vob.bak"):
            self.write(self.paths["ETC"] / name)
        self.write(self.paths["STD"] / "vob.dat")
        sub = self.paths["ETC"] / "sub"
        sub.mkdir()
        self.write(sub / "vob.dat")
        app = self.app(2026)
        files = self.initial(app)["files"]
        self.assertEqual({item["name"] for item in files}, {"vo2.FRA", "volume", "vob.bak"})
        for item in files:
            self.assertTrue(self.call(app, "vob.open", {"path": item["path"]})["ok"])
        rejected = self.call(app, "vob.open", {"path": str(sub / "vob.dat")})
        self.assertFalse(rejected["ok"])

    def test_allplan_2022_is_the_minimum_supported_version(self):
        expected = self.write(self.paths["ETC"] / "vob_FRA.fra")
        app = self.app(2022)

        data = self.initial(app)

        self.assertEqual([item["path"] for item in data["files"]], [str(expected)])
        self.assertEqual(data["context"]["version"], "2022")

    def test_version_99_is_available_in_inventory_and_file_commands(self):
        expected = self.write(self.paths["ETC"] / "vob_FRA.fra")
        app = self.app(99)
        data = self.initial(app)
        self.assertEqual(data["context"]["version"], "99")
        listing = self.call(app, "vob.files.list", {
            "version": "99", "source": str(self.paths["ETC"]),
            "allVersions": True,
        })
        self.assertTrue(listing["ok"], listing)
        self.assertEqual(listing["data"]["context"]["versions"], ["99"])
        self.assertEqual(
            [item["path"] for item in listing["data"]["files"]], [str(expected)],
        )
        opened = self.call(app, "vob.open", {"path": str(expected)})
        self.assertTrue(opened["ok"], opened)
        self.assertEqual(opened["data"]["file"]["version"], "99")

    def test_listing_missing_country_reports_warning(self):
        data = self.initial(self.app(2027, country=""))
        self.assertEqual(data["files"], [])
        self.assertTrue(data["warnings"])

    def test_files_list_returns_only_the_requested_real_source_and_context(self):
        project_file = self.write(self.catalog / "vob_FRA.dat")
        std_file = self.write(self.paths["STD"] / "vob_FRA.dat")
        app = self.app(2027)

        result = self.call(app, "vob.files.list", {
            "version": "2027",
            "source": str(self.paths["STD"]),
        })

        self.assertTrue(result["ok"], result)
        self.assertEqual([item["path"] for item in result["data"]["files"]], [str(std_file)])
        self.assertEqual(result["data"]["context"]["source"], str(self.paths["STD"]))
        self.assertNotIn(project_file, [item["path"] for item in result["data"]["files"]])

    def test_projects_add_multiple_persists_empty_projects_and_restores_inventory(self):
        project_a = self.paths["PRJ"] / "Projet A"
        project_b = self.paths["PRJ"] / "Projet B"
        project_a.mkdir()
        project_b.mkdir()
        vob = self.write(project_a / "vob_FRA.dat")
        app = self.app(2027)
        window = FakeWindow(dialog_result=(str(project_a), str(project_b)))
        app._attach_window(window)

        result = self.call(
            app, "vob.projects.add", {"path": None, "multiple": True}
        )

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            [item["project"]["name"] for item in result["data"]["projects"]],
            ["Projet A", "Projet B"],
        )
        self.assertEqual(result["data"]["projects"][0]["files"][0]["path"], str(vob))
        self.assertEqual(result["data"]["projects"][1]["files"], [])
        self.assertEqual(result["data"]["projects"][0]["files"][0]["source"], "PRJ")
        self.assertTrue(window.dialog_calls[0][1]["allow_multiple"])
        settings = self.settings.load("vob_editor")["vobResources"]
        self.assertEqual(len(settings["addedProjects"]), 2)
        self.assertIn(
            str(vob),
            [item["path"] for item in app.get_initial_data()["files"]],
        )
        opened = self.call(app, "vob.open", {"path": str(vob)})
        self.assertTrue(opened["ok"], opened)
        self.assertEqual(opened["data"]["file"]["projectName"], "Projet A")
        self.assertTrue(self.call(app, "vob.save", opened["data"])["ok"])
        refreshed = self.call(app, "vob.files.list", {
            "version": "2027",
            "source": str(self.paths["STD"]),
            "allVersions": True,
            "projects": settings["addedProjects"],
        })
        self.assertTrue(refreshed["ok"], refreshed)
        self.assertIn(str(vob), [item["path"] for item in refreshed["data"]["files"]])

        restarted = self.app(2027)
        refreshed = self.call(restarted, "vob.files.list", {
            "version": "2027",
            "source": str(self.paths["STD"]),
            "allVersions": True,
            "projects": settings["addedProjects"],
        })
        self.assertTrue(refreshed["ok"], refreshed)
        self.assertIn(str(vob), [item["path"] for item in refreshed["data"]["files"]])
        data = self.initial(restarted)
        self.assertIn(str(vob), [item["path"] for item in data["files"]])
        self.assertEqual(
            {item["projectPath"] for item in data["files"] if item["source"] == "PRJ"},
            {str(project_a)},
        )

    def test_projects_add_dialog_cancellation_returns_null_data(self):
        app = self.app(2027)
        app._attach_window(FakeWindow())

        result = self.call(
            app, "vob.projects.add", {"path": None, "multiple": True}
        )

        self.assertEqual(result, {"ok": True, "data": None})

    def test_project_folder_dialog_falls_back_to_repeated_single_selection(self):
        project_a = self.paths["PRJ"] / "Projet A"
        project_b = self.paths["PRJ"] / "Projet B"
        project_a.mkdir()
        project_b.mkdir()

        class SingleFolderWindow:
            def __init__(self):
                self.results = [str(project_a), str(project_b), None]
                self.calls = []

            def create_file_dialog(self, *args, **kwargs):
                self.calls.append((args, kwargs))
                return self.results.pop(0)

        window = SingleFolderWindow()
        app = self.app(2027)
        app._attach_window(window)

        result = app._add_projects_dialog(multiple=True)

        self.assertEqual(result, [str(project_a), str(project_b)])
        self.assertEqual(
            [call[1]["allow_multiple"] for call in window.calls],
            [True, False, False],
        )

    def test_multi_version_inventory_omits_empty_versions_and_uses_unique_ids(self):
        active_file = self.write(self.paths["STD"] / "vob_FRA.dat")
        older_paths = {}
        for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
            directory = self.root / "2026" / name
            directory.mkdir(parents=True)
            older_paths[name] = directory
        older_file = self.write(older_paths["ETC"] / "vo2_deu.deu")
        empty_paths = {}
        for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
            directory = self.root / "2025" / name
            directory.mkdir(parents=True)
            empty_paths[name] = directory

        current = VobEditorAllplanDatas(
            AllplanPaths("2027", "FRA", paths=self.paths),
            catalog_user_path=self.catalog,
        )
        older = VobEditorAllplanDatas(
            AllplanPaths("2026", paths=older_paths),
        )
        empty = VobEditorAllplanDatas(
            AllplanPaths("2025", paths=empty_paths),
        )
        app = VobEditorApp(
            self.root / "multi-data",
            settings_store=self.settings,
            allplan_datas=current,
            allplan_versions={"2027": current, "2026": older, "2025": empty},
        )
        self.addCleanup(app._close)

        result = self.call(app, "vob.files.list", {
            "version": "2027",
            "source": str(self.paths["STD"]),
            "allVersions": True,
        })

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["context"]["versions"], ["2027", "2026"])
        files = result["data"]["files"]
        self.assertEqual({item["version"] for item in files}, {"2027", "2026"})
        self.assertEqual(len(files), 2)
        self.assertEqual(len({item["id"] for item in files}), len(files))
        self.assertEqual(
            {item["path"] for item in files}, {str(active_file), str(older_file)}
        )
        preview = self.call(app, "vob.preview", {"path": str(older_file)})
        self.assertTrue(preview["ok"], preview)
        self.assertEqual(preview["data"]["file"]["version"], "2026")
        self.assertIsNone(app._current_document)
        self.assertEqual(app._layouts, {})
        opened = self.call(app, "vob.open", {"path": str(older_file)})
        self.assertTrue(opened["ok"], opened)
        self.assertEqual(opened["data"]["rules"][0]["trade"], "1")
        self.assertEqual(opened["data"]["file"]["path"], str(older_file))
        initial_files = app.get_initial_data()["files"]
        self.assertEqual(
            {item["id"] for item in initial_files},
            {item["id"] for item in files},
        )

    def test_min_version_filters_inventory_before_scanning_older_providers(self):
        active_file = self.write(self.paths["ETC"] / "vob_FRA.dat")
        versions = {"2027": VobEditorAllplanDatas(
            AllplanPaths("2027", "FRA", paths=self.paths),
            catalog_user_path=self.catalog,
        )}
        for version in ("2026", "2021"):
            other_paths = {}
            for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
                directory = self.root / version / name
                directory.mkdir(parents=True)
                other_paths[name] = directory
            provider = VobEditorAllplanDatas(AllplanPaths(version, paths=other_paths))
            self.write(other_paths["ETC"] / "vob_FRA.dat")
            provider.list_vob_files = unittest.mock.Mock(
                side_effect=AssertionError("version below minVersion was scanned")
            )
            versions[version] = provider
        app = VobEditorApp(
            self.root / "min-version-data", settings_store=self.settings,
            allplan_datas=versions["2027"], allplan_versions=versions,
        )
        self.addCleanup(app._close)

        result = self.call(app, "vob.files.list", {
            "version": "2027", "source": str(self.paths["ETC"]),
            "allVersions": True, "minVersion": 2027,
        })

        self.assertTrue(result["ok"], result)
        self.assertEqual([item["path"] for item in result["data"]["files"]], [str(active_file)])
        self.assertEqual(result["data"]["context"]["versions"], ["2027"])

    def test_unsupported_installations_are_not_scanned_and_their_files_are_rejected(self):
        current = VobEditorAllplanDatas(
            AllplanPaths("2027", "FRA", paths=self.paths),
            catalog_user_path=self.catalog,
        )
        old_paths = {}
        for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
            directory = self.root / "2021" / name
            directory.mkdir(parents=True)
            old_paths[name] = directory
        old_file = self.write(old_paths["ETC"] / "vob_FRA.fra")
        old = VobEditorAllplanDatas(AllplanPaths("2021", paths=old_paths))
        old.list_vob_files = unittest.mock.Mock(
            side_effect=AssertionError("unsupported version was scanned")
        )
        app = VobEditorApp(
            self.root / "unsupported-data", settings_store=self.settings,
            allplan_datas=current, allplan_versions={"2027": current, "2021": old},
        )
        self.addCleanup(app._close)

        result = self.call(app, "vob.open", {"path": str(old_file)})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "unsupported-version")
        revealed = self.call(app, "vob.file.reveal", {"path": str(old_file)})
        self.assertEqual(revealed["error"]["code"], "unsupported-version")
        old_project = old_paths["PRJ"] / "Ancien projet"
        old_project.mkdir()
        selected_project = self.call(app, "vob.projects.add", {
            "path": str(old_project),
        })
        self.assertEqual(selected_project["error"]["code"], "unsupported-version")
        min_version = self.call(app, "vob.files.list", {
            "version": "2027", "source": str(self.paths["ETC"]),
            "allVersions": True, "minVersion": 2021,
        })
        self.assertEqual(min_version["error"]["code"], "unsupported-version")
        listing = self.call(app, "vob.files.list", {
            "version": "2027", "source": str(self.paths["ETC"]),
            "allVersions": True,
        })
        self.assertTrue(listing["ok"], listing)
        old.list_vob_files.assert_not_called()
        self.assertNotIn(str(old_file), [item["path"] for item in listing["data"]["files"]])
        self.settings.save("vob_editor", {
            "version": 1,
            "vobEditorSession": {
                "selectedFiles": [str(old_file)], "lastFile": str(old_file),
            },
        })
        initial = self.initial(app)
        self.assertIsNone(initial["document"])
        self.assertNotIn(str(old_file), [item["path"] for item in initial["files"]])

        legacy_app = VobEditorApp(
            self.root / "legacy-data", settings_store=self.settings,
            allplan_datas=old,
        )
        self.addCleanup(legacy_app._close)
        rejected = self.call(legacy_app, "vob.files.list", {
            "version": "2021", "source": str(old_paths["ETC"]),
        })
        self.assertEqual(rejected["error"]["code"], "unsupported-version")
        old.list_vob_files.assert_not_called()

    def test_neighboring_path_is_not_mistaken_for_an_old_installation(self):
        current = VobEditorAllplanDatas(
            AllplanPaths("2027", "FRA", paths=self.paths),
            catalog_user_path=self.catalog,
        )
        old_paths = {}
        for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"):
            directory = self.root / "2021" / name
            directory.mkdir(parents=True)
            old_paths[name] = directory
        neighbor = self.root / "2021" / "ETC-neighbor"
        neighbor.mkdir()
        candidate = self.write(neighbor / "vob_personal.fra")
        app = VobEditorApp(
            self.root / "neighbor-data", settings_store=self.settings,
            allplan_datas=current,
            allplan_versions={"2027": current, "2021": VobEditorAllplanDatas(
                AllplanPaths("2021", paths=old_paths),
            )},
        )
        self.addCleanup(app._close)

        result = self.call(app, "vob.files.add", {"paths": [str(candidate)]})

        self.assertTrue(result["ok"], result)
        self.assertNotIn("version", result["data"]["files"][0])

    def test_import_classification_is_persisted_and_rebuilt_after_restart(self):
        etc_file = self.write(self.paths["ETC"] / "vob_FRA.dat")
        std_file = self.write(self.paths["STD"] / "vo2_FRA.dat")
        project_path = self.paths["PRJ"] / "Projet sélectionné"
        project_path.mkdir()
        project_file = self.write(project_path / "vob_FRA.dat")
        app = self.app(2027)
        app._attach_window(FakeWindow(dialog_result=(str(project_path),)))
        selected = self.call(app, "vob.projects.add", {"path": None})
        self.assertTrue(selected["ok"], selected)

        imported = self.call(app, "vob.files.add", {
            "paths": [str(etc_file), str(std_file), str(project_file)],
        })

        self.assertTrue(imported["ok"], imported)
        metadata = {item["path"]: item for item in imported["data"]["files"]}
        self.assertEqual(metadata[str(etc_file)]["source"], "ETC")
        self.assertEqual(metadata[str(std_file)]["source"], "STD")
        self.assertEqual(metadata[str(project_file)]["source"], "PRJ")
        self.assertEqual(metadata[str(project_file)]["projectName"], project_path.name)
        self.assertTrue(all(item["version"] == "2027" for item in metadata.values()))

        persisted = self.settings.load("vob_editor")["vobResources"]["addedFiles"]
        self.assertTrue(all("version" in item and "source" in item for item in persisted))
        stale_resources = dict(self.settings.load("vob_editor")["vobResources"])
        stale_resources["addedFiles"] = [
            {key: item[key] for key in ("id", "name", "path")}
            | {"source": str(Path(item["path"]).parent)}
            for item in persisted
        ]
        self.settings.save(
            "vob_editor", {"version": 1, "vobResources": stale_resources},
        )
        restarted = self.app(2027)
        restored = self.initial(restarted)
        restored_files = {item["path"]: item for item in restored["files"]}
        self.assertEqual(restored_files[str(project_file)]["projectName"], project_path.name)
        self.assertEqual(restored_files[str(project_file)]["projectPath"], str(project_path))
        reclassified = {
            item["path"]: item
            for item in self.settings.load("vob_editor")["vobResources"]["addedFiles"]
        }
        self.assertEqual(reclassified[str(etc_file)]["source"], "ETC")
        self.assertEqual(reclassified[str(std_file)]["source"], "STD")
        self.assertEqual(reclassified[str(project_file)]["source"], "PRJ")

    def test_shared_installation_roots_are_not_assigned_arbitrarily(self):
        shared = self.write(self.paths["ETC"] / "vob_FRA.dat")
        current = VobEditorAllplanDatas(
            AllplanPaths("2027", "FRA", paths=self.paths),
            catalog_user_path=self.catalog,
        )
        other = VobEditorAllplanDatas(AllplanPaths("2026", paths=self.paths))
        app = VobEditorApp(
            self.root / "ambiguous-data", settings_store=self.settings,
            allplan_datas=current, allplan_versions={"2027": current, "2026": other},
        )
        self.addCleanup(app._close)
        initial_paths = {item["path"] for item in self.initial(app)["files"]}
        self.assertNotIn(str(shared), initial_paths)

        result = self.call(app, "vob.files.add", {"paths": [str(shared)]})

        self.assertTrue(result["ok"], result)
        self.assertNotIn("version", result["data"]["files"][0])
        self.assertEqual(result["data"]["files"][0]["source"], str(shared.parent))

    def test_file_actions_reject_unknown_paths_then_call_windows_handlers(self):
        known = self.write(self.paths["STD"] / "vob_FRA.dat")
        app = self.app(2027)
        missing = self.call(app, "vob.file.reveal", {
            "path": str(self.paths["STD"] / "missing.fra"),
        })
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["error"]["code"], "not_found")

        with patch("application.plugins.vob_editor.application.os.name", "nt"), patch(
            "application.plugins.vob_editor.application.subprocess.Popen"
        ) as popen:
            revealed = self.call(app, "vob.file.reveal", {"path": str(known)})
            self.assertEqual(revealed, {"ok": True, "data": None})
            popen.assert_called_once_with(
                ["explorer.exe", f'/select,"{known}"']
            )

        with patch("application.plugins.vob_editor.application.os.name", "nt"), patch(
            "application.plugins.vob_editor.application.os.startfile", create=True
        ) as startfile:
            opened = self.call(app, "vob.file.open_external", {"path": str(known)})
            self.assertEqual(opened, {"ok": True, "data": None})
            startfile.assert_called_once_with(str(known))

    def test_invalid_content_is_not_editable(self):
        path = self.paths["ETC"] / "volume"
        path.write_bytes(b"not a VOB file")
        result = self.call(self.app(2026), "vob.open", {"path": str(path)})
        self.assertEqual(result["error"]["code"], "invalid")

    def test_etc_is_read_only_but_save_as_and_session_still_work(self):
        source = self.write(self.paths["ETC"] / "vob_FRA.dat")
        app = self.app(2027)
        document = self.call(app, "vob.open", {"path": str(source)})["data"]
        refused = self.call(app, "vob.save", document)
        self.assertEqual(refused["error"]["code"], "write_error")
        self.assertFalse(source.with_suffix(".dat.bak").exists())
        target = self.root / "vob_copy.dat"
        app._attach_window(FakeWindow(dialog_result=(str(target),)))
        result = self.call(app, "vob.save_as", document)
        self.assertTrue(result["ok"], result)
        self.assertEqual(target.read_bytes(), source.read_bytes())
        restored = self.initial(self.app(2027))
        self.assertEqual(restored["document"]["file"]["path"], str(target))

    def test_std_save_works_and_other_country_is_not_authorized_by_root(self):
        source = self.write(self.paths["STD"] / "vob_FRA.dat")
        other = self.write(self.paths["STD"] / "vob_DEU.dat")
        app = self.app(2027)
        document = self.call(app, "vob.open", {"path": str(source)})["data"]
        document["rules"][0]["formula"] = "B"
        self.assertTrue(self.call(app, "vob.save", document)["ok"])
        self.assertIn(b"#B", source.read_bytes())
        self.assertFalse(self.call(app, "vob.open", {"path": str(other)})["ok"])

    def test_size_and_listing_limits(self):
        source = self.write(self.paths["ETC"] / "vo2.dat")
        self.write(self.paths["ETC"] / "vob.dat")
        provider = VobEditorAllplanDatas(AllplanPaths("2026", paths=self.paths), max_file_bytes=2)
        with self.assertRaises(ValueError):
            provider.read_vob_bytes(source)
        listing = provider.list_vob_files(max_files=1)
        self.assertEqual(len(listing["files"]), 1)
        self.assertTrue(listing["truncated"])

    def test_detection_worker_and_serialization(self):
        args = create_parser().parse_args([
            "--allplan-version", "2027", "--country", "FRA",
            "--paths", str(self.root / "paths.json"), "--timeout", "2",
        ])
        context = AllplanPaths("2027", "FRA", paths=self.paths)
        with patch("application.core.launching.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = json.dumps({"ok": True, "data": context.to_dict()})
            restored = detect_allplan(args)
        self.assertEqual(restored.paths, self.paths)
        self.assertIn("--country", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["timeout"], 2)
        args.paths.write_text(json.dumps(context.to_dict()), encoding="utf-8")
        detected = detect_allplan(args)
        self.assertEqual(detected.paths, self.paths)
        self.assertEqual(detected.country, "FRA")

    def test_version_discovery_returns_other_resolved_installations(self):
        active = AllplanPaths("2027", "FRA", paths=self.paths)
        payload = {
            "ok": True,
            "data": {
                "installations": [
                    active.to_dict(),
                    AllplanPaths("2026", "DEU", paths=self.paths).to_dict(),
                ],
                "diagnostics": [],
            },
        }
        args = argparse.Namespace(timeout=2)
        with patch("application.plugins.vob_editor.discovery.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = json.dumps(payload)
            versions = detect_allplan_versions(args, active)

        self.assertEqual(list(versions), ["2026"])
        self.assertEqual(versions["2026"].paths, self.paths)
        self.assertIn("--list-paths", run.call_args.args[0])

    def test_launcher_rejects_versions_before_detecting_installation(self):
        with patch(
            "argparse.ArgumentParser.error", side_effect=SystemExit,
        ), patch("application.launcher.main.detect_allplan") as detect:
            with self.assertRaises(SystemExit):
                launcher_main(["vob_editor", "--allplan-version", "2021"])
        detect.assert_not_called()

    def test_netmanager_xml_is_parsed_and_dtd_is_rejected(self):
        xml = self.paths["ETC"] / "netmanager.xml"
        central = self.root / "central"
        (central / "Std").mkdir(parents=True)
        (central / "Prj").mkdir()
        overrides = {key: value for key, value in self.paths.items() if key not in ("STD", "PRJ")}
        xml.write_text(f"<Net><Active>0</Active><Path>{central}</Path></Net>", encoding="utf-8")
        result = resolve_paths("2027", overrides=overrides, country="FRA")
        self.assertEqual(result.paths["STD"], central / "Std")
        xml.write_text('<!DOCTYPE Net [<!ENTITY x "bad">]><Net/>', encoding="utf-8")
        result = resolve_paths("2027", overrides=overrides)
        self.assertTrue(any("DTDForbidden" in item for item in result.diagnostics))
