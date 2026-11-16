from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from application.core.context import LaunchContext
from application.launcher.aim_remote_review import ReviewApi
from application.plugins.information_manager.presentation import AimPresentationApp
from application.plugins.information_manager.project_manager import MANAGER_COMMANDS, MANAGER_MENU_COMMANDS
from tests import test_aim_project_reading as fixtures


class ProjectManagerTests(unittest.TestCase):
    def setUp(self):
        self.base = fixtures.ProjectReadingTests()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.base.content("Version 3\r\n7|Zero|0\r\n8|False|false\r\n9|Empty|\r\n")
        self.app = self.make_app(self.base.project)
        self.state = self.app.get_initial_data()
        example = json.loads((Path(__file__).parent / "fixtures" /
                              "aim_frontend_update_example.json").read_text("utf-8"))
        self.configuration = example["configuration"]

    def make_app(self, project=None):
        b = self.base
        return AimPresentationApp(
            b.data, LaunchContext(project_path=project),
            settings_store=b.store, choose_directory=b.chooser,
            discover_installations=b.discover, presentation_update=True,
        )

    def make_assignment_app(self, project=None):
        app = self.make_app(project)
        app._set_project_manager_assignment(True)
        return app

    def call(self, suffix, payload=None):
        return self.app.call("project.manager." + suffix, {} if payload is None else payload)

    def add(self, path=None):
        self.base.chooser.return_value = str(path or self.base.project)
        return self.call("add")

    def test_inventory_is_explicit_persistent_unique_and_not_recent_history(self):
        second = self.base.outside_project()
        before = self.app.call("project.recent", {})
        self.assertEqual(self.call("list"), {"ok": True, "projects": []})
        self.assertEqual(self.add(second)["status"], "added")
        self.assertEqual(self.add(second)["status"], "added")
        inventory = self.call("list")
        self.assertEqual(len(inventory["projects"]), 1)
        self.assertEqual(inventory["projects"][0]["path"], str(second))
        self.assertEqual(inventory["projects"][0]["source"]["version"], "2024")
        self.assertEqual(self.app.call("project.recent", {}), before)
        self.assertEqual(self.app.get_initial_data(), self.state)
        self.base.discover.reset_mock()
        self.base.chooser.reset_mock()
        restarted = self.make_app()
        self.assertEqual(restarted.call("project.manager.list", {}), inventory)
        self.base.discover.assert_not_called()
        self.base.chooser.assert_not_called()
        self.assertIsNone(restarted._state)

    def test_project_installation_assignment_is_distinct_from_definition_source(self):
        app = self.make_assignment_app()
        self.assertEqual(app.get_app_info()["project_manager_assignment_contract"], 1)
        self.base.chooser.return_value = str(self.base.project)
        added = app.call("project.manager.add", {})
        self.assertEqual(added["project"]["projectInstallation"], {
            "status": "associated", "version": "2024",
            "verificationVersion": False, "prjPath": str(self.base.project.parent),
        })
        self.base.chooser.return_value = str(self.base.outside_project())
        external = app.call("project.manager.add", {})["project"]
        self.assertEqual(external["source"]["version"], "2024")
        self.assertEqual(external["projectInstallation"], {"status": "unassociated"})
        listed = app.call("project.manager.list", {})["projects"]
        self.assertEqual(len(listed), 2)
        by_path = {item["path"]: item for item in listed}
        self.assertEqual(
            by_path[str(self.base.project)]["projectInstallation"]["status"], "associated",
        )
        self.assertEqual(
            by_path[external["path"]]["projectInstallation"]["status"], "unassociated",
        )

        restarted = self.make_assignment_app()
        self.base.discover.reset_mock()
        reread = restarted.call("project.manager.list", {})
        self.assertEqual(reread, {"ok": True, "projects": listed})
        self.base.discover.assert_not_called()

    def test_legacy_and_ambiguous_project_affiliation_are_explicit_unknowns(self):
        app = self.make_assignment_app()
        source = self.app.call("project.source", {})["source"]
        self.base.store.save(app.app_id, {
            "version": 1, "aimProjectManager": {"projects": [
                {"path": str(self.base.project), "source": source},
            ]},
        })
        legacy = app.call("project.manager.list", {})["projects"][0]
        self.assertEqual(legacy["projectInstallation"], {
            "status": "unknown", "reason": "legacy_entry",
        })

        from dataclasses import replace
        self.base.discover.return_value = (
            [self.base.context, replace(self.base.context, allplan_version="2025")], [],
        )
        self.base.chooser.return_value = str(self.base.project)
        refreshed = app.call("project.manager.preview", {
            "path": str(self.base.project),
        })
        self.assertEqual(refreshed["preview"]["projectInstallation"], {
            "status": "unknown", "reason": "ambiguous",
        })
        current = app.call("project.manager.list", {})["projects"][0]
        self.assertEqual(current["projectInstallation"]["reason"], "ambiguous")

    def test_add_cancel_and_error_preserve_inventory_active_document_and_history(self):
        before = self.base.store._path.read_bytes()
        document = self.app._document
        self.base.chooser.return_value = None
        self.assertEqual(self.call("add"), {"ok": True, "status": "cancelled"})
        self.base.chooser.return_value = str(self.base.root / "Missing.prj")
        self.assertEqual(self.call("add")["error"]["code"], "project_read_error")
        self.assertEqual(self.app.get_initial_data(), self.state)
        self.assertIs(self.app._document, document)
        self.assertEqual(self.base.store._path.read_bytes(), before)

    def test_preview_reads_only_selected_project_and_keeps_zero_false_not_empty(self):
        second = self.base.outside_project()
        (second / "prjatt.dat").write_text("Version 3\n7|Zero|0\n8|False|false\n9|Empty|\n", encoding="cp1252")
        self.add(second)
        self.app.call("presentation.update", {"configuration": self.configuration})
        before = self.app.call("presentation.get", {})
        document = self.app._document
        history = self.app.call("project.recent", {})
        fingerprint = hashlib.sha256((second / "prjatt.dat").read_bytes()).hexdigest()
        preview = self.call("preview", {"path": str(second)})
        self.assertEqual(preview["status"], "preview")
        self.assertEqual(preview["preview"]["mode"], "attributes_without_presentation")
        self.assertEqual([(r["number"], r["value"]) for r in preview["preview"]["items"]],
                         [("7", "0"), ("8", "false")])
        self.assertIsNone(preview["preview"]["items"][1]["title"])
        self.assertEqual(self.app.get_initial_data(), self.state)
        self.assertIs(self.app._document, document)
        self.assertEqual(self.app.call("presentation.get", {}), before)
        self.assertEqual(self.app.call("project.recent", {}), history)
        self.assertEqual(hashlib.sha256((second / "prjatt.dat").read_bytes()).hexdigest(), fingerprint)
        (second / "prjatt.dat").write_text("Version 3\n7|Name|changed\n", encoding="cp1252")
        refreshed = self.call("preview", {"path": str(second)})
        self.assertEqual(refreshed["preview"]["items"][0]["value"], "changed")
        self.assertEqual(self.app.call("presentation.get", {}), before)

    def test_current_project_preview_reuses_confirmed_presentation_and_filters_empty_groups(self):
        self.add()
        configuration = deepcopy(self.configuration)
        group = configuration["categories"][0]["groups"][0]
        empty = deepcopy(group)
        empty.update(id="empty-group", position=2, rows=[])
        configuration["categories"][0]["groups"].append(empty)
        self.app.call("presentation.update", {"configuration": configuration})
        preview = self.call("preview", {"path": str(self.base.project)})["preview"]
        self.assertEqual(preview["mode"], "current_presentation")
        self.assertEqual(len(preview["items"]), 1)
        self.assertEqual([row["id"] for row in preview["items"][0]["rows"]], ["row-a", "row-b"])
        self.assertEqual([row["value"] for row in preview["items"][0]["rows"]], ["0", "0"])

    def test_preview_failure_does_not_replace_active_state_or_pending_import(self):
        second = self.base.outside_project()
        self.add(second)
        source = self.base.root / "presentation.json"
        source.write_text(json.dumps(self.configuration), encoding="utf-8")
        self.app._presentation._choose_file = lambda: source
        token = self.app.call("presentation.import.prepare", {})["token"]
        before = self.app.get_initial_data()
        history = self.app.call("project.recent", {})
        (second / "project.cfg").write_bytes(b"ATTR=INVALID\n")
        self.assertEqual(self.call("preview", {"path": str(second)})["error"]["code"],
                         "project_read_error")
        self.assertEqual(self.app.get_initial_data(), before)
        self.assertEqual(self.app.call("project.recent", {}), history)
        self.assertTrue(self.app.call("presentation.import.apply", {"token": token})["ok"])

    def test_preview_color_is_opt_in_and_copies_confirmed_v1_and_v2_model(self):
        self.add()
        for mixed in (False, True):
            with self.subTest(mixed=mixed):
                configuration = deepcopy(self.configuration)
                groups = configuration["categories"][0]["groups"]
                groups[0]["backgroundColor"] = "#a0C0e0"
                second = deepcopy(groups[0])
                second.update(id="group-b", position=2, backgroundColor="#F6E9D1")
                for row in second["rows"]:
                    row["id"] += "-b"
                groups.append(second)
                empty = deepcopy(groups[0])
                empty.update(id="empty-group", position=3, rows=[], backgroundColor="#123456")
                groups.append(empty)
                if mixed:
                    configuration["version"] = 2
                    for category in configuration["categories"]:
                        category["children"] = category.pop("groups")
                        for group in category["children"]:
                            group["kind"] = "group"
                            for row in group["rows"]:
                                row["kind"] = "row"
                self.app._set_presentation_tree(mixed)
                self.app._set_project_manager_preview_color(False)
                self.assertTrue(self.app.call("presentation.update", {"configuration": configuration})["ok"])
                before = self.app.call("presentation.get", {})
                history = self.app.call("project.recent", {})
                document = self.app._document
                hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in self.base.project.rglob("*") if p.is_file()}
                legacy = self.call("preview", {"path": str(self.base.project)})
                self.assertNotIn("project_manager_preview_color_contract", self.app.get_app_info())
                for group in legacy["preview"]["items"]:
                    self.assertEqual(set(group), {"kind", "id", "title", "rows"})
                self.app._set_project_manager_preview_color(True)
                self.assertEqual(self.app.get_app_info()["project_manager_preview_color_contract"], 1)
                api = ReviewApi(self.app)
                api.active = True
                api.get_app_info()
                colored = api.call("project.manager.preview", {"path": str(self.base.project)})
                groups = colored["preview"]["items"]
                model_groups = before["presentation"]["model"]["categories"][0][
                    "children" if mixed else "groups"]
                self.assertEqual([g["backgroundColor"] for g in groups], ["#a0C0e0", "#F6E9D1"])
                self.assertEqual([g["title"] for g in groups], [g["title"] for g in model_groups[:2]])
                self.assertEqual([g["backgroundColor"] for g in groups],
                                 [g["backgroundColor"] for g in model_groups[:2]])
                for group in groups:
                    self.assertEqual(set(group), {"kind", "id", "title", "rows", "backgroundColor"})
                    group.pop("backgroundColor")
                self.assertEqual(colored, legacy)
                self.assertEqual(self.app.call("presentation.get", {}), before)
                self.assertEqual(self.app.call("project.recent", {}), history)
                self.assertIs(self.app._document, document)
                self.assertTrue(all(hashlib.sha256(p.read_bytes()).hexdigest() == digest
                                    for p, digest in hashes.items()))
                self.app._set_project_manager_preview_color(False)
                self.assertEqual(self.call("preview", {"path": str(self.base.project)}), legacy)

    def test_preview_color_does_not_invent_groups_for_other_project_or_no_presentation(self):
        self.app._set_project_manager_preview_color(True)
        self.add()
        preview = self.call("preview", {"path": str(self.base.project)})["preview"]
        self.assertEqual(preview["mode"], "attributes_without_presentation")
        self.assertTrue(all(r["kind"] == "row" and "backgroundColor" not in r for r in preview["items"]))
        self.assertTrue(self.app.call("presentation.update", {"configuration": self.configuration})["ok"])
        second = self.base.outside_project()
        self.add(second)
        preview = self.call("preview", {"path": str(second)})["preview"]
        self.assertEqual(preview["mode"], "attributes_without_presentation")
        self.assertTrue(all(r["kind"] == "row" and "backgroundColor" not in r for r in preview["items"]))
        for invalid in (None, True, "", "red", "#fff", "#00000000"):
            configuration = deepcopy(self.configuration)
            configuration["categories"][0]["groups"][0]["backgroundColor"] = invalid
            self.assertEqual(self.app.call("presentation.update", {"configuration": configuration})[
                "error"]["code"], "invalid_presentation")
        configuration = deepcopy(self.configuration)
        del configuration["categories"][0]["groups"][0]["backgroundColor"]
        self.assertEqual(self.app.call("presentation.update", {"configuration": configuration})[
            "error"]["code"], "invalid_presentation")

    def test_complete_colored_preview_handoff_fixture_matches_python_output(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        example = json.loads((fixture_dir / "aim_frontend_update_example.json").read_text("utf-8"))
        expected = json.loads((fixture_dir / "aim_preview_color_example.json").read_text("utf-8"))
        configuration = example["configuration"]
        configuration["categories"][0]["groups"][0]["backgroundColor"] = "#a0C0e0"
        for group in configuration["categories"][0].pop("groups"):
            group["kind"] = "group"
            for row in group["rows"]:
                row["kind"] = "row"
            configuration["categories"][0].setdefault("children", []).append(group)
        configuration["version"] = 2
        self.app._set_project_manager_preview_color(True)
        reader = SimpleNamespace(_document=SimpleNamespace(values=lambda: {"7": "0"}))
        with patch.dict(vars(self.app), {"_state": example["snapshot"]}), \
                patch.dict(vars(self.app._presentation), {
                    "_current": {"configuration": configuration, "report": None},
                }):
            preview = self.app._manager._preview(example["snapshot"], reader)
        self.assertEqual({"ok": True, "status": "preview", "preview": preview}, expected)

    def test_open_requires_explicit_presentation_abandon_and_preserves_on_failure(self):
        second = self.base.outside_project()
        self.add(second)
        self.app.call("presentation.update", {"configuration": self.configuration})
        previous = self.app.call("presentation.get", {})
        payload = {"path": str(second), "discardPresentation": False}
        self.assertEqual(self.call("open", payload)["error"]["code"], "presentation_confirmation_required")
        self.assertEqual(self.app.get_initial_data(), self.state)
        self.assertEqual(self.app.call("presentation.get", {}), previous)
        payload["discardPresentation"] = True
        original = (second / "project.cfg").read_bytes()
        (second / "project.cfg").write_bytes(b"ATTR=BAD")
        self.assertFalse(self.call("open", payload)["ok"])
        self.assertEqual(self.app.call("presentation.get", {}), previous)
        self.assertEqual(self.app.get_initial_data(), self.state)
        (second / "project.cfg").write_bytes(original)
        reply = self.call("open", payload)
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["data"]["project"]["path"], str(second))
        self.assertEqual(self.app.call("presentation.get", {})["status"], "empty")
        self.assertEqual(self.app.call("project.recent", {})["projects"][0]["path"], str(second))

    def test_same_project_open_keeps_presentation_without_forced_abandon(self):
        self.add()
        self.app.call("presentation.update", {"configuration": self.configuration})
        before = self.app.call("presentation.get", {})
        self.assertTrue(self.call("open", {
            "path": str(self.base.project), "discardPresentation": False,
        })["ok"])
        self.assertEqual(self.app.call("presentation.get", {}), before)

    def test_pending_import_requires_confirmation_before_opening_another_project(self):
        second = self.base.outside_project()
        self.add(second)
        source = self.base.root / "presentation.json"
        source.write_text(json.dumps(self.configuration), encoding="utf-8")
        self.app._presentation._choose_file = lambda: source
        token = self.app.call("presentation.import.prepare", {})["token"]
        self.assertEqual(self.call("open", {
            "path": str(second), "discardPresentation": False,
        })["error"]["code"], "presentation_confirmation_required")
        self.assertEqual(self.app.get_initial_data(), self.state)
        self.assertTrue(self.app.call("presentation.import.apply", {"token": token})["ok"])

    def test_corrupt_manager_inventory_refuses_select_without_uncaught_error_or_state_loss(self):
        before = self.app.get_initial_data()
        self.base.store.save(self.app.app_id, {
            "version": 1, "aimProjectManager": {"projects": "broken"},
        })
        reply = self.app.call("project.select", {"path": str(self.base.project)})
        self.assertEqual(reply["error"]["code"], "history_unavailable")
        self.assertEqual(self.app.get_initial_data(), before)

    def test_footer_source_is_actual_definitions_installation_not_launch_version(self):
        newer = self.base.installation("2026")
        self.base.discover.return_value = ([newer, self.base.context], [])
        app = self.make_app(self.base.project)
        state = app.get_initial_data()
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(app.call("project.source", {})["source"], {
            "status": "resolved", "version": "2024", "verificationVersion": False, "reason": None,
        })
        self.assertEqual(self.make_app().call("project.source", {})["source"], {
            "status": "unresolved", "version": None, "verificationVersion": None,
            "reason": "definitions_not_loaded",
        })

    def test_manager_failures_are_explicit_and_never_accepted_as_empty_success(self):
        before = self.app.get_initial_data()
        for suffix, payload in (
            ("list", {"extra": True}), ("add", {"path": str(self.base.project)}),
            ("preview", {}), ("open", {"path": str(self.base.project), "discardPresentation": "yes"}),
        ):
            self.assertEqual(self.call(suffix, payload)["error"]["code"], "invalid_payload")
        for suffix in ("open", "preview"):
            payload = {"path": str(self.base.project)}
            if suffix == "open":
                payload["discardPresentation"] = True
            self.assertEqual(self.call(suffix, payload)["error"]["code"], "project_not_added")
        self.base.store.save(self.app.app_id, {"version": 1, "aimProjectManager": {"projects": "broken"}})
        self.assertEqual(self.call("list")["error"]["code"], "manager_unavailable")
        self.assertEqual(self.app.get_initial_data(), before)
        source = self.app.call("project.source", {})["source"]
        for invalid in (
            {**source, "reason": "incorrect"},
            {**source, "version": source["version"] + ".0"},
            {"status": "unresolved", "version": None, "verificationVersion": None, "reason": None},
        ):
            self.base.store.save(self.app.app_id, {
                "version": 1, "aimProjectManager": {"projects": [
                    {"path": str(self.base.project), "source": invalid},
                ]},
            })
            self.assertEqual(self.call("list")["error"]["code"], "manager_unavailable")

    def test_storage_failure_during_add_and_preview_is_explicit_and_keeps_active(self):
        self.add()
        before = self.app.get_initial_data()
        document = self.app._document
        with patch("application.core.configuration.SettingsStore.save",
                   side_effect=PermissionError("read-only settings")):
            self.assertEqual(self.call("add")["error"]["code"], "manager_unavailable")
            self.assertEqual(self.call("preview", {
                "path": str(self.base.project),
            })["error"]["code"], "manager_unavailable")
        self.assertEqual(self.app.get_initial_data(), before)
        self.assertIs(self.app._document, document)

    def test_extensions_do_not_change_strict_project_or_presentation_contracts(self):
        api = ReviewApi(self.app)
        with self.assertRaises(RuntimeError):
            api.call("project.manager.list", {})
        api.active = True
        info = api.get_app_info()
        self.assertEqual(info["project_manager_contract"], 1)
        self.assertEqual(info["project_history_contract"], 1)
        self.assertEqual(info["capabilities"], ["project.select"])
        self.assertEqual(len(info["presentation_capabilities"]), 6)
        self.assertEqual(api.call("project.manager.list", {}), {"ok": True, "projects": []})
        legacy = AimPresentationApp(self.base.data, LaunchContext())
        self.assertEqual(len(legacy.get_app_info()["presentation_capabilities"]), 5)
        self.assertEqual(legacy.call("presentation.update", {
            "configuration": self.configuration,
        })["error"]["code"], "unknown_command")
        self.assertEqual(len(MANAGER_COMMANDS), 5)

    def test_mixed_preview_preserves_direct_line_group_direct_line_common_order(self):
        from application.plugins.information_manager.presentation_structure import upgrade_configuration
        self.add()
        self.app._set_presentation_tree(True)
        configuration = upgrade_configuration(self.configuration)
        children = configuration["categories"][0]["children"]
        first = children[0]["rows"].pop(0)
        first["position"] = 1
        children.insert(0, first)
        children[1]["position"] = 2
        children[1]["rows"][0]["position"] = 1
        last = deepcopy(first)
        last.update(id="last-direct", position=3)
        children.append(last)
        self.assertTrue(self.app.call("presentation.update", {"configuration": configuration})["ok"])
        preview = self.call("preview", {"path": str(self.base.project)})["preview"]
        self.assertEqual([item["kind"] for item in preview["items"]], ["row", "group", "row"])
        self.assertEqual([item["id"] for item in preview["items"]], ["row-a", "group-a", "last-direct"])

    def test_preview_model_failure_returns_explicit_error_and_preserves_active(self):
        self.add()
        self.app.call("presentation.update", {"configuration": self.configuration})
        before = self.app.call("presentation.get", {})
        with patch("application.plugins.information_manager.project_manager.display_model",
                   side_effect=RuntimeError("test preview unavailable")):
            self.assertEqual(self.call("preview", {
                "path": str(self.base.project),
            })["error"]["code"], "preview_unavailable")
        self.assertEqual(self.app.call("presentation.get", {}), before)

    def test_menu_is_opt_in_and_does_not_extend_old_strict_lists_or_entries(self):
        old_info = self.app.get_app_info()
        self.assertNotIn("project_manager_menu_contract", old_info)
        for command in MANAGER_MENU_COMMANDS:
            self.assertEqual(self.app.call(command, {})["error"]["code"], "unknown_command")
        self.app._set_project_manager_menu(True)
        info = self.app.get_app_info()
        self.assertEqual(info.pop("project_manager_menu_contract"), 1)
        self.assertEqual(info, old_info)
        api = ReviewApi(self.app)
        api.active = True
        api.get_app_info()
        self.assertEqual(api.call("project.manager.favorites.list", {}), {"ok": True, "paths": []})
        self.add()
        entry = self.call("list")["projects"][0]
        self.assertEqual(set(entry), {"path", "name", "source", "sourceFreshness"})

    def test_favorites_persist_use_same_identity_and_preserve_project_history_and_presentation(self):
        self.app._set_project_manager_menu(True)
        self.add()
        self.app.call("presentation.update", {"configuration": self.configuration})
        before_state = self.app.get_initial_data()
        before_presentation = self.app.call("presentation.get", {})
        before_history = self.app.call("project.recent", {})
        canonical = str(self.base.project)
        for path in (canonical, canonical.upper()):
            reply = self.call("favorite.set", {"path": path, "favorite": True})
            self.assertEqual(reply, {"ok": True, "status": "updated", "path": canonical, "favorite": True})
        self.assertEqual(self.call("favorites.list"), {"ok": True, "paths": [canonical]})
        restarted = self.make_app()
        restarted._set_project_manager_menu(True)
        self.assertEqual(restarted.call("project.manager.favorites.list", {}), {"ok": True, "paths": [canonical]})
        self.call("preview", {"path": canonical})
        self.add()
        self.assertEqual(self.call("favorites.list")["paths"], [canonical])
        self.assertEqual(self.app.get_initial_data(), before_state)
        self.assertEqual(self.app.call("presentation.get", {}), before_presentation)
        self.assertEqual(self.app.call("project.recent", {}), before_history)
        self.assertTrue(self.call("favorite.set", {"path": canonical, "favorite": False})["ok"])
        self.assertEqual(self.call("favorites.list")["paths"], [])

    def test_remove_clears_only_inventory_and_favorite_even_if_folder_has_disappeared(self):
        self.app._set_project_manager_menu(True)
        self.add()
        second = self.base.outside_project()
        self.add(second)
        canonical = str(self.base.project)
        self.call("favorite.set", {"path": canonical, "favorite": True})
        self.app.call("presentation.update", {"configuration": self.configuration})
        state = self.app.get_initial_data()
        presentation = self.app.call("presentation.get", {})
        recent = self.app.call("project.recent", {})
        document = self.app._document
        hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in self.base.project.rglob("*") if p.is_file()}
        reply = self.call("remove", {"path": canonical.upper()})
        self.assertEqual(reply, {"ok": True, "status": "removed", "path": canonical})
        self.assertEqual(self.call("favorites.list")["paths"], [])
        self.assertEqual([p["path"] for p in self.call("list")["projects"]], [str(second)])
        self.assertEqual(self.app.get_initial_data(), state)
        self.assertIs(self.app._document, document)
        self.assertEqual(self.app.call("presentation.get", {}), presentation)
        self.assertEqual(self.app.call("project.recent", {}), recent)
        self.assertTrue(all(hashlib.sha256(p.read_bytes()).hexdigest() == sha for p, sha in hashes.items()))
        self.assertEqual(self.call("remove", {"path": canonical})["error"]["code"], "project_not_added")
        moved = second.with_name("Moved.prj")
        second.rename(moved)
        try:
            self.assertTrue(self.call("remove", {"path": str(second)})["ok"])
        finally:
            moved.rename(second)
        self.assertEqual(self.call("list")["projects"], [])
        self.assertTrue(second.is_dir())

    def test_menu_storage_failure_does_not_report_success_or_change_state(self):
        self.app._set_project_manager_menu(True)
        self.add()
        path = str(self.base.project)
        self.call("favorite.set", {"path": path, "favorite": True})
        settings = self.base.store._path.read_bytes()
        state = self.app.get_initial_data()
        with patch.object(self.base.store, "save", side_effect=PermissionError("read-only")):
            for suffix, payload in (
                ("favorite.set", {"path": path, "favorite": False}), ("remove", {"path": path}),
            ):
                self.assertEqual(self.call(suffix, payload)["error"]["code"], "manager_unavailable")
        self.assertEqual(self.base.store._path.read_bytes(), settings)
        self.assertEqual(self.app.get_initial_data(), state)

    def test_folder_open_uses_registered_directory_only_and_no_project_reader(self):
        self.app._set_project_manager_menu(True)
        self.add()
        canonical = str(self.base.project)
        state = self.app.get_initial_data()
        settings = self.base.store._path.read_bytes()
        with patch("application.plugins.information_manager.project_manager.os.startfile", create=True) as launch, \
                patch.object(self.app._manager, "_isolated_reader", side_effect=AssertionError("read")):
            self.assertEqual(self.call("folder.open", {"path": canonical.upper()}),
                             {"ok": True, "status": "opened", "path": canonical})
            launch.assert_called_once_with(canonical, "explore")
            for path in (str(self.base.root / "Unknown.prj"), str(self.base.root), canonical + "\\..\\Other.prj"):
                self.assertFalse(self.call("folder.open", {"path": path})["ok"])
            launch.assert_called_once()
            moved = self.base.project.with_name("Moved.prj")
            self.base.project.rename(moved)
            try:
                self.assertEqual(self.call("folder.open", {"path": canonical})["error"]["code"],
                                 "project_folder_unavailable")
            finally:
                moved.rename(self.base.project)
            launch.side_effect = PermissionError("Explorer refused")
            self.assertEqual(self.call("folder.open", {"path": canonical})["error"]["code"],
                             "project_folder_unavailable")
            with patch("application.plugins.information_manager.project_manager.os", SimpleNamespace(name="posix")):
                self.assertEqual(self.call("folder.open", {"path": canonical})["error"]["code"],
                                 "unsupported_platform")
        self.assertEqual(self.base.store._path.read_bytes(), settings)
        self.assertEqual(self.app.get_initial_data(), state)

    def test_menu_rejects_bad_payloads_unknown_projects_and_corrupt_favorites(self):
        self.app._set_project_manager_menu(True)
        self.add()
        path = str(self.base.project)
        for suffix, payload in (
            ("favorites.list", {"extra": True}), ("favorite.set", {"path": path, "favorite": 1}),
            ("favorite.set", {"path": path}), ("remove", {"path": path, "delete": True}),
            ("folder.open", {"path": 42}),
        ):
            self.assertEqual(self.call(suffix, payload)["error"]["code"], "invalid_payload")
        for suffix in ("favorite.set", "remove", "folder.open"):
            payload = {"path": str(self.base.root / "Unknown.prj")}
            if suffix == "favorite.set":
                payload["favorite"] = True
            self.assertEqual(self.call(suffix, payload)["error"]["code"], "project_not_added")
        for invalid in ("broken", [False], ["relative"], [str(self.base.root / "Unknown.prj")]):
            self.base.store.save(self.app.app_id, {
                "version": 1, "aimProjectManager": {"favorites": invalid},
            })
            self.assertEqual(self.call("favorites.list")["error"]["code"], "manager_unavailable")


if __name__ == "__main__":
    unittest.main()
