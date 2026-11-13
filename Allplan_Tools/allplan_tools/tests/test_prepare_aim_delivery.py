"""Preparation tests run only in temporary destinations, without application launch."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile


SUITE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "prepare_aim_delivery", SUITE / "tools" / "prepare_aim_delivery.py",
)
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.out = self.root / "candidate"
        self.profile = self.root / "profile"
        self.pin = self.root / "pin"
        self.lot = self.root / "lot"
        self.pin.mkdir()
        self.lot.mkdir()
        self.python = Path(sys.executable).resolve()

    def run_prepare(self):
        return prepare.prepare(self.out, self.profile, self.pin, self.lot, self.python)

    def fake_validation(self, *args, **kwargs):
        return {
            "descriptor": {
                "schema": "aim-local-installation/1", "revision": "revision",
                "tree": "tree", "sha256": "sha256", "pythonState": "state",
                "artifact": str(self.pin / prepare.ARCHIVE_NAME),
            },
            "pythonFiles": {"project.py": hashlib.sha256(b"pinned").hexdigest()},
            "resourceCount": 28,
        }

    def fake_assembly(self, out, python_exe, profile, candidate):
        application = out / "python" / "application"
        application.mkdir(parents=True)
        (application / "project.py").write_bytes(b"overlay")
        (out / "runtime.json").write_text(json.dumps({
            "pythonRoot": str(out / "python"), "profile": str(profile),
            "pinnedCandidate": str(candidate), "pythonExecutable": str(python_exe),
        }))
        prepare.assembler().write_json(out / "work-manifest.json", {
            "schema": "allplan-tools-launcher-work/1",
            "files": {
                "python/application/project.py": "old", "runtime.json": "old",
            },
        })

    def test_candidate_and_profile_existing_even_empty_are_refused(self):
        for destination in (self.out, self.profile):
            with self.subTest(destination=destination):
                destination.mkdir()
                with patch.object(prepare, "validate") as validate:
                    with self.assertRaises(FileExistsError):
                        self.run_prepare()
                    validate.assert_not_called()
                destination.rmdir()

    def test_dangling_destination_link_is_refused(self):
        with patch.object(prepare.os.path, "lexists", return_value=True):
            with self.assertRaises(FileExistsError):
                prepare.require_absent(self.out)

    def test_absolute_paths_and_disjoint_destinations_required(self):
        with self.assertRaises(ValueError):
            prepare.absolute_path(Path("relative"))
        with self.assertRaises(ValueError):
            prepare.prepare(self.out, self.out / "profile", self.pin, self.lot, self.python)
        with self.assertRaises(ValueError):
            prepare.prepare(self.lot / "candidate", self.profile, self.pin, self.lot, self.python)

    def test_archive_failure_creates_no_delivery(self):
        with patch.object(prepare, "validate", side_effect=ValueError("archive invalide")):
            with self.assertRaisesRegex(ValueError, "archive invalide"):
                self.run_prepare()
        self.assertFalse(self.out.exists())
        self.assertFalse(self.profile.exists())

    def test_lot_changed_after_validation_rolls_back_without_descriptor(self):
        (self.lot / "project.py").write_bytes(b"divergent")
        assembly = prepare.assembler()
        with patch.object(prepare, "validate", side_effect=self.fake_validation), \
                patch.object(assembly, "assemble", side_effect=self.fake_assembly), \
                patch.object(prepare, "assembler", return_value=assembly):
            with self.assertRaisesRegex(ValueError, "Lot AIM modifie"):
                self.run_prepare()
        self.assertFalse(self.out.exists())
        self.assertFalse(self.profile.exists())

    def test_final_validation_failure_rolls_back_without_descriptor(self):
        (self.lot / "project.py").write_bytes(b"pinned")
        assembly = prepare.assembler()
        with patch.object(prepare, "validate", side_effect=[
            self.fake_validation(), ValueError("final refuse"),
        ]), patch.object(assembly, "assemble", side_effect=self.fake_assembly), \
                patch.object(prepare, "assembler", return_value=assembly):
            with self.assertRaisesRegex(ValueError, "final refuse"):
                self.run_prepare()
        self.assertFalse(self.out.exists())
        self.assertFalse(self.profile.exists())

    def test_exact_descriptor_final_manifest_and_same_roots(self):
        (self.lot / "project.py").write_bytes(b"pinned")
        assembly = prepare.assembler()
        preflight = {
            "status": "verified", "python_root": str(self.out / "python"),
            "profile": str(self.profile), "interpreter": str(self.python),
        }
        with patch.object(prepare, "validate", side_effect=self.fake_validation) as validate, \
                patch.object(assembly, "assemble", side_effect=self.fake_assembly), \
                patch.object(prepare, "assembler", return_value=assembly), \
                patch.object(prepare, "checked_process", return_value=preflight) as child:
            result = self.run_prepare()
        descriptor = json.loads(Path(result["descriptor"]).read_text())
        self.assertEqual(descriptor, self.fake_validation()["descriptor"])
        self.assertEqual(set(descriptor), {
            "schema", "revision", "tree", "sha256", "pythonState", "artifact",
        })
        manifest = json.loads((self.out / "work-manifest.json").read_text())
        self.assertEqual(manifest["files"]["python/application/project.py"],
                         hashlib.sha256(b"pinned").hexdigest())
        self.assertEqual(manifest["preparationReplacements"][-1]["before"],
                         hashlib.sha256(b"overlay").hexdigest())
        self.assertEqual(manifest["preparationReplacements"][-1]["layer"], "aim")
        for call in validate.call_args_list[1:]:
            self.assertEqual(call.args[1], self.out / "python")
            self.assertEqual(call.kwargs["profile"], self.profile)
        self.assertEqual(child.call_args.kwargs["cwd"], self.out / "python")

    def test_preflight_failure_removes_final_descriptor(self):
        (self.lot / "project.py").write_bytes(b"pinned")
        assembly = prepare.assembler()
        with patch.object(prepare, "validate", side_effect=self.fake_validation), \
                patch.object(assembly, "assemble", side_effect=self.fake_assembly), \
                patch.object(prepare, "assembler", return_value=assembly), \
                patch.object(prepare, "checked_process", side_effect=ValueError("preflight refuse")):
            with self.assertRaisesRegex(ValueError, "preflight refuse"):
                self.run_prepare()
        self.assertFalse(self.out.exists())
        self.assertFalse(self.profile.exists())

    def test_outside_application_import_refused(self):
        external = SimpleNamespace(__file__=str(self.root / "outside.py"))
        with patch.dict(sys.modules, {"application.external": external}):
            with self.assertRaisesRegex(RuntimeError, "hors racine"):
                prepare.confined_modules(self.out)

    def test_outside_package_search_path_refused(self):
        package = SimpleNamespace(
            __file__=str(self.out / "__init__.py"), __path__=[str(self.root / "outside")],
        )
        with patch.dict(sys.modules, {"application": package}):
            with self.assertRaisesRegex(RuntimeError, "Package applicatif hors racine"):
                prepare.confined_modules(self.out)

    def test_worker_is_isolated_and_has_no_archive_override(self):
        with patch.object(prepare, "checked_process", return_value={}) as child:
            prepare.validate(self.python, prepare.SOURCES, self.pin, aim_application=self.lot)
        command = child.call_args.args[0]
        self.assertEqual(command[1:3], ["-I", "-B"])
        request = json.loads(command[-1])
        self.assertEqual(request["pinnedCandidate"], str(self.pin))
        self.assertNotIn("archive", request)
        self.assertNotIn("PYTHONPATH", child.call_args.kwargs["env"])

    def test_validate_only_refuses_destinations(self):
        with self.assertRaises(SystemExit):
            prepare.main([
                "--validate-only", "--out", str(self.out), "--pinned-candidate", str(self.pin),
                "--aim-application", str(self.lot), "--python", str(self.python),
            ])
        self.assertFalse(self.out.exists())


@unittest.skipUnless(
    os.environ.get("AIM_TEST_PINNED_CANDIDATE") and os.environ.get("AIM_TEST_APPLICATION"),
    "Explicit read-only AIM fixtures required; see preparation documentation.",
)
class PinnedPreparationTests(unittest.TestCase):
    def setUp(self):
        PreparationTests.setUp(self)
        self.pin = Path(os.environ["AIM_TEST_PINNED_CANDIDATE"]).resolve()
        self.reference_lot = Path(os.environ["AIM_TEST_APPLICATION"]).resolve()

    def test_real_temporary_preparation_and_preflight(self):
        result = prepare.prepare(
            self.out, self.profile, self.pin, self.reference_lot, self.python,
        )
        self.assertEqual(result["resourceCount"], 28)
        manifest = json.loads((self.out / "work-manifest.json").read_text())
        aim = [item for item in manifest["preparationReplacements"] if item["layer"] == "aim"]
        self.assertEqual(len(aim), 11)
        descriptor = json.loads(Path(result["descriptor"]).read_text())
        self.assertEqual(descriptor, {
            "schema": "aim-local-installation/1",
            "revision": "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
            "tree": "a5f51ec092b2dabf2796ea67628d05d859ce5d08",
            "sha256": "6452e7d92e24f03d8c1ab738eaeeeb1380cca35c384a4293329348f0add97b52",
            "pythonState": "aim-working-state-0b05206",
            "artifact": str(self.pin / prepare.ARCHIVE_NAME),
        })
        runtime = json.loads((self.out / "runtime.json").read_text())
        self.assertEqual(runtime["pythonRoot"], str(self.out / "python"))
        runtime["pythonRoot"] = str(prepare.SOURCES)
        (self.out / "runtime.json").write_text(json.dumps(runtime))
        manifest["files"]["runtime.json"] = hashlib.sha256(
            (self.out / "runtime.json").read_bytes(),
        ).hexdigest()
        (self.out / "work-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(subprocess.CalledProcessError) as refused:
            prepare.validate(self.python, self.out / "python", self.pin, profile=self.profile)
        self.assertIn("Configuration et racine verifiee incoherentes", refused.exception.stderr)

    def test_real_archive_and_python_divergence_no_outputs(self):
        temporary_pin = self.root / "altered-pin"
        temporary_pin.mkdir()
        archive = temporary_pin / prepare.ARCHIVE_NAME
        original = (self.pin / prepare.ARCHIVE_NAME).read_bytes()
        archive.write_bytes(original + b"altered")
        with self.assertRaises(subprocess.CalledProcessError):
            prepare.prepare(self.out, self.profile, temporary_pin, self.reference_lot, self.python)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.profile.exists())
        archive.write_bytes(original)
        with self.assertRaises(subprocess.CalledProcessError):
            prepare.prepare(self.out, self.profile, temporary_pin, self.lot, self.python)
        self.assertFalse(self.profile.exists())

    def test_altered_resource_rejected_by_complete_validator(self):
        archive = self.root / "resource-altered.zip"
        with zipfile.ZipFile(self.pin / prepare.ARCHIVE_NAME) as source, \
                zipfile.ZipFile(archive, "w") as target:
            for entry in source.infolist():
                body = source.read(entry.filename)
                if entry.filename == "document.html":
                    body += b"altered"
                target.writestr(entry, body)
        # Simulate an otherwise trusted envelope to exercise the independent inner inventory check.
        code = """
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from application.launcher import aim_local_delivery as delivery
real_hash = delivery.hashlib.sha256
archive = Path(sys.argv[2])
envelope = archive.read_bytes()
def digest(body):
    if body == envelope:
        class Envelope:
            def hexdigest(self):
                return delivery.WORKING_ARTIFACT_SHA256
        return Envelope()
    return real_hash(body)
with patch.object(delivery.hashlib, 'sha256', side_effect=digest):
    try:
        delivery.local_resources(archive, expected_sha256=delivery.WORKING_ARTIFACT_SHA256,
                                 revision=delivery.WORKING_REVISION)
    except ValueError as exc:
        assert str(exc) == 'Ressource AIM locale modifiee.', str(exc)
    else:
        raise AssertionError('Altered resource accepted')
"""
        subprocess.run(
            [str(self.python), "-I", "-B", "-c", code, str(prepare.SOURCES), str(archive)],
            check=True, capture_output=True, text=True, timeout=60,
        )


if __name__ == "__main__":
    unittest.main()
