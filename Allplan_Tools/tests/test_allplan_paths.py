import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from application.core.allplan.paths import installed_paths, is_supported_version, resolve_paths
from application.core.context import installation_key


class AllplanVersionTests(unittest.TestCase):
    def test_supported_versions_include_99_but_not_other_old_versions(self):
        for version in ("99", 99, "2022", "2026", "2027"):
            self.assertTrue(is_supported_version(version), version)
        for version in ("98", "100", "2021", "latest", None):
            self.assertFalse(is_supported_version(version), version)

    def test_old_versions_are_rejected_before_registry_access(self):
        registry = Mock()
        with self.assertRaisesRegex(ValueError, "2021 non pris en charge"):
            resolve_paths("2021", registry=registry)
        registry.installations.assert_not_called()

    def test_99_can_resolve_explicit_paths(self):
        with TemporaryDirectory() as root:
            paths = dict.fromkeys(("ETC", "PRG", "STD", "PRJ", "USR", "TMP"), Path(root))
            self.assertTrue(resolve_paths("99", overrides=paths).to_dict()["complete"])

    def test_discovery_skips_old_versions_before_resolving_paths(self):
        with patch("application.core.allplan.paths.Registry") as factory, patch(
            "application.core.allplan.paths.resolve_paths",
        ) as resolve:
            factory.return_value.installations.return_value = [
                {"version": "2021", "verification_version": False},
                {"version": "99", "verification_version": True},
                {"version": "2022", "verification_version": False},
            ]
            factory.return_value.errors = []
            resolve.return_value.paths = {}
            resolve.return_value.diagnostics = []
            installed_paths()
        self.assertEqual(
            [call.args[0] for call in resolve.call_args_list], ["99", "2022"],
        )


@unittest.skipUnless(os.name == "nt", "Windows Documents and network paths")
class AllplanUserPathsTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.documents = self.root / "Redirected Documents"
        self.documents.mkdir()
        self.registry_path = r"SOFTWARE\NEMETSCHEK\Allplan\2026.0"
        self.verification_version = False
        self.registry = Mock()
        self.registry.errors = []
        self.registry.values.return_value = {"installed": "yes"}
        self.overrides = {
            name: self.root for name in ("ETC", "PRG", "STD", "PRJ", "TMP")
        }
        self.shell = self.enterContext(patch(
            "ctypes.windll.shell32.SHGetFolderPathW",
            side_effect=self.documents_path,
        ))

    def documents_path(self, _window, _folder, _token, _flags, buffer):
        buffer.value = str(self.documents)
        return 0

    def resolve(self):
        return resolve_paths(
            "2026", overrides=self.overrides, registry=self.registry,
            verification_version=self.verification_version,
        )

    def test_redirected_documents_uses_nemetschek_directory_first(self):
        expected = self.documents / "Nemetschek" / "Allplan" / "2026" / "Usr"
        expected.mkdir(parents=True)
        (self.documents / "Allplan" / "2026" / "Usr").mkdir(parents=True)
        state = self.resolve()
        self.assertEqual(state.paths["USR"], expected)
        self.assertEqual(state.sources["USR"], "fallback:Documents")
        self.assertFalse(any(" USR" in message for message in state.diagnostics))

    def test_legacy_documents_remains_available(self):
        expected = self.documents / "Allplan" / "2026" / "Usr"
        expected.mkdir(parents=True)
        state = self.resolve()
        self.assertEqual(state.paths["USR"], expected)
        self.assertEqual(state.sources["USR"], "fallback:Documents:legacy")

    def test_verification_uses_separate_versioned_user_directory(self):
        for version in ("99", "2026"):
            with self.subTest(version=version):
                expected = (
                    self.documents / "Nemetschek" / f"Allplan_{version}_Verification"
                    / version / "Usr"
                )
                expected.mkdir(parents=True)
                state = resolve_paths(
                    version, overrides=self.overrides, registry=self.registry,
                    verification_version=True,
                )
                self.assertEqual(state.paths["USR"], expected)
                self.assertEqual(state.sources["USR"], "fallback:Documents:Verification")

    def test_missing_verification_does_not_use_production_user_directory(self):
        (self.documents / "Nemetschek" / "Allplan" / "2026" / "Usr").mkdir(parents=True)
        self.verification_version = True
        state = self.resolve()
        self.assertIsNone(state.paths["USR"])
        self.assertTrue(any("Allplan_2026_Verification" in item for item in state.diagnostics))

    def test_tmp_uses_local_appdata_for_production_and_verification(self):
        self.overrides.pop("TMP")
        local = self.root / "Local AppData"
        with patch.dict(os.environ, {"LOCALAPPDATA": str(local)}):
            for version, verification in (("2026", False), ("2026", True), ("99", True)):
                with self.subTest(version=version, verification=verification):
                    folder = f"Allplan_{version}_Verification" if verification else "Allplan"
                    expected = local / "Nemetschek" / folder / version / "Tmp"
                    expected.mkdir(parents=True)
                    state = resolve_paths(
                        version, overrides=self.overrides, registry=self.registry,
                        verification_version=verification,
                    )
                    self.assertEqual(state.paths["TMP"], expected)
                    self.assertEqual(
                        state.sources["TMP"],
                        "fallback:LocalAppData:Verification" if verification else "fallback:LocalAppData",
                    )
                    self.overrides["TMP"] = self.root
                    explicit = resolve_paths(
                        version, overrides=self.overrides, registry=self.registry,
                        verification_version=verification,
                    )
                    self.assertEqual(explicit.paths["TMP"], self.root)
                    self.assertEqual(explicit.sources["TMP"], "explicit")
                    self.overrides.pop("TMP")

    def test_missing_verification_tmp_does_not_use_production_directory(self):
        self.overrides.pop("TMP")
        local = self.root / "Local AppData"
        (local / "Nemetschek" / "Allplan" / "2026" / "Tmp").mkdir(parents=True)
        self.verification_version = True
        with patch.dict(os.environ, {"LOCALAPPDATA": str(local)}):
            state = self.resolve()
        self.assertIsNone(state.paths["TMP"])
        expected = local / "Nemetschek" / "Allplan_2026_Verification" / "2026" / "Tmp"
        self.assertTrue(any(
            "Allplan 2026" in item and "TMP" in item
            and "source=fallback:LocalAppData:Verification" in item
            and repr(str(expected)) in item
            for item in state.diagnostics
        ), state.diagnostics)

    def test_redirected_documents_preserves_unc_and_mapped_drive(self):
        for documents in (
            r"\\domain.example\users\user.name\Documents",
            r"Z:\Documents",
        ):
            with self.subTest(documents=documents):
                self.documents = Path(documents)
                with patch("application.core.allplan.paths.Path.is_dir", return_value=True):
                    state = self.resolve()
                self.assertEqual(
                    state.paths["USR"],
                    self.documents / "Nemetschek" / "Allplan" / "2026" / "Usr",
                )

    def test_custom_network_user_directory_keeps_priority(self):
        expected = Path(r"\\server\AllplanUsers\DOMAIN.user\Usr")

        def values(_hive, key, _view):
            if key.endswith(r"\InstallRoot"):
                return {"installed": "yes"}
            if key.endswith(r"\InstallTrace"):
                return {"netmanager": "on"}
            if key.endswith(r"\CustomizedPaths"):
                return {"usr": str(expected)}
            return {}

        self.registry.values.side_effect = values
        with patch("application.core.allplan.paths.Path.is_dir", return_value=True):
            state = self.resolve()
        self.assertEqual(state.paths["USR"], expected)
        self.assertEqual(state.sources["USR"], "custom:HKLM")

    def test_explicit_user_directory_keeps_priority(self):
        self.overrides["USR"] = self.root
        self.assertEqual(self.resolve().paths["USR"], self.root)

    def test_missing_directory_diagnostics_include_context_and_paths(self):
        state = self.resolve()
        self.assertIsNone(state.paths["USR"])
        for folder in ("Nemetschek\\Allplan", "Allplan"):
            searched = self.documents / folder / "2026" / "Usr"
            self.assertTrue(any(
                "Allplan 2026" in message
                and installation_key("2026") in message
                and "source=fallback:Documents" in message
                and repr(str(searched)) in message
                and "Dossier absent ou inaccessible" in message
                for message in state.diagnostics
            ), state.diagnostics)

    def test_windows_documents_failure_is_explicit(self):
        self.shell.side_effect = None
        self.shell.return_value = -2147024891
        state = self.resolve()
        self.assertIsNone(state.paths["USR"])
        self.assertTrue(any(
            "Allplan 2026" in message
            and "Windows:Documents" in message
            and "HRESULT=-2147024891" in message
            for message in state.diagnostics
        ))

    def test_invalid_override_diagnostic_includes_searched_value(self):
        self.overrides["USR"] = "relative"
        state = self.resolve()
        self.assertIsNone(state.paths["USR"])
        self.assertTrue(any(
            "Allplan 2026" in message and "source=explicit" in message
            and "chemin recherche='relative'" in message
            for message in state.diagnostics
        ))
