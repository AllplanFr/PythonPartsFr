"""Prepare an isolated AIM work delivery; never install or start an application."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


TOOLS = Path(__file__).resolve().parent
SUITE = TOOLS.parent
SOURCES = SUITE.parent
ARCHIVE_NAME = "AIM_candidate_0b05206.zip"


def absolute_path(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts or "\0" in str(path):
        raise ValueError("Chemin absolu sans .. ni NUL requis : " + str(path))
    if path.resolve() != path:
        raise ValueError("Chemin indirect interdit : " + str(path))
    return path


def require_absent(path):
    if os.path.lexists(path):
        raise FileExistsError("Destination deja presente : " + str(path))


def confined_modules(python_root):
    for name, module in tuple(sys.modules.items()):
        if name == "application" or name.startswith("application."):
            location = getattr(module, "__file__", None)
            if not location or not Path(location).resolve().is_relative_to(python_root):
                raise RuntimeError("Module applicatif hors racine : " + name)
            for location in getattr(module, "__path__", ()):
                if not Path(location).resolve().is_relative_to(python_root):
                    raise RuntimeError("Package applicatif hors racine : " + name)


def worker(request):
    """Import the complete validators in a fresh, isolated interpreter."""
    python_root = absolute_path(request["pythonRoot"])
    confined_modules(python_root)
    sys.path.insert(0, str(python_root))
    from application.launcher import aim_local_delivery as delivery
    from application.core.resources import PACKAGE_ROOT

    if PACKAGE_ROOT.resolve() != python_root / "application":
        raise RuntimeError("Racine Python AIM incorrecte.")
    revision = delivery.WORKING_REVISION
    pin = delivery.delivery_pin(revision)
    archive = absolute_path(request["pinnedCandidate"]) / ARCHIVE_NAME
    build, resources = delivery.local_resources(
        archive, expected_sha256=pin["sha256"], revision=revision,
    )
    if request["mode"] == "archive":
        application = absolute_path(request["aimApplication"])
        for name, digest in pin["python_files"].items():
            path = application / name
            if path.resolve() != path or delivery.hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("Fichier Python AIM divergent : " + name)
    else:
        from application.core.work_identity import verify_work_copy
        from application.core import launching

        verify_work_copy()
        delivery.verify_python(revision)
        config = json.loads((python_root.parent / "runtime.json").read_text(encoding="utf-8"))
        expected = {
            "pythonRoot": str(python_root),
            "profile": request["profile"],
            "pinnedCandidate": request["pinnedCandidate"],
            "pythonExecutable": str(Path(sys.executable).resolve()),
        }
        if any(config.get(key) != value for key, value in expected.items()):
            raise ValueError("Configuration et racine verifiee incoherentes.")
        if (launching.ROOT.resolve() != python_root
                or launching.launcher_command() != [sys.executable, "-m", "application"]):
            raise ValueError("Racine d'execution du plugin incoherente.")
        if request["mode"] == "installed":
            delivery.installed_resources()
    confined_modules(python_root)
    return {
        "descriptor": {
            "schema": "aim-local-installation/1",
            "revision": revision,
            "tree": pin["tree"],
            "sha256": pin["sha256"],
            "pythonState": pin["python_state"],
            "artifact": str(archive),
        },
        "pythonFiles": pin["python_files"],
        "resourceCount": len(resources),
        "trackedChangesAtBuild": build["trackedChangesAtBuild"],
        "pythonRoot": str(python_root),
    }


def checked_process(command, *, cwd, env):
    try:
        result = subprocess.run(
            command, cwd=str(cwd), env=env, capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=60, check=True,
        )
    except subprocess.CalledProcessError as exc:
        exc.add_note("Validation refusee :\n" + (exc.stderr or exc.stdout or "(sortie vide)"))
        raise
    return json.loads(result.stdout)


def validate(python_exe, python_root, pinned_candidate, *, aim_application=None,
             profile=None, installed=False):
    request = {
        "mode": "archive" if aim_application is not None else (
            "installed" if installed else "final"
        ),
        "pythonRoot": str(python_root),
        "pinnedCandidate": str(pinned_candidate),
    }
    if aim_application is not None:
        request["aimApplication"] = str(aim_application)
    if profile is not None:
        request["profile"] = str(profile)
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    if profile is not None:
        env["LOCALAPPDATA"] = str(profile)
    return checked_process(
        [str(python_exe), "-I", "-B", str(Path(__file__).resolve()),
         "--_worker", json.dumps(request)],
        cwd=python_root, env=env,
    )


def assembler():
    spec = importlib.util.spec_from_file_location(
        "aim_delivery_assembler", SUITE / "assemble_package.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare(out, profile, pinned_candidate, aim_application, python_exe):
    out, profile, pinned_candidate, aim_application, python_exe = (
        absolute_path(value) for value in
        (out, profile, pinned_candidate, aim_application, python_exe)
    )
    for destination in (out, profile):
        require_absent(destination)
        for protected in (SOURCES, pinned_candidate, aim_application, python_exe.parent):
            if destination.is_relative_to(protected) or protected.is_relative_to(destination):
                raise ValueError("Destination recouvrant une source : " + str(destination))
    if out.is_relative_to(profile) or profile.is_relative_to(out):
        raise ValueError("Candidate et profil doivent etre disjoints.")
    if not python_exe.is_file():
        raise FileNotFoundError("Interpreteur absent : " + str(python_exe))

    verified = validate(
        python_exe, SOURCES, pinned_candidate, aim_application=aim_application,
    )
    assembly = assembler()
    replacements = []
    overlay = SUITE / "overlay" / "python"
    for source in sorted(overlay.rglob("*")):
        if source.is_file():
            relative = source.relative_to(overlay)
            original = SOURCES / relative
            replacements.append({
                "file": relative.as_posix(), "layer": "overlay",
                "before": assembly.sha256(original) if original.is_file() else None,
                "after": assembly.sha256(source),
            })
    owned = []
    try:
        # Reserve both destinations exclusively; only these newly owned trees are cleaned on failure.
        for destination in (out, profile):
            destination.mkdir(parents=True, exist_ok=False)
            owned.append(destination)
        assembly.assemble(out, python_exe, profile, pinned_candidate)
        python_root = out / "python"
        for name, digest in verified["pythonFiles"].items():
            source = aim_application / name
            if assembly.sha256(source) != digest:
                raise ValueError("Lot AIM modifie pendant la preparation : " + name)
            target = python_root / "application" / name
            replacements.append({
                "file": target.relative_to(python_root).as_posix(), "layer": "aim",
                "before": assembly.sha256(target), "after": digest,
            })
            shutil.copy2(source, target)
        manifest_path = out / "work-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["modifiedPythonFiles"] = sorted({
            item["file"] for item in replacements
        })
        manifest["preparationReplacements"] = replacements
        manifest["files"] = {
            name: assembly.sha256(out / name) for name in manifest["files"]
        }
        assembly.write_json(manifest_path, manifest)
        final = validate(python_exe, python_root, pinned_candidate, profile=profile)
        if final["descriptor"] != verified["descriptor"]:
            raise ValueError("Identite AIM modifiee pendant la preparation.")
        descriptor = profile / "AllplanWebLauncher" / "information_manager" / "local-delivery.json"
        descriptor.parent.mkdir(parents=True)
        with descriptor.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(final["descriptor"], indent=2) + "\n")
        validate(python_exe, python_root, pinned_candidate, profile=profile, installed=True)
        env = os.environ.copy()
        env["LOCALAPPDATA"] = str(profile)
        preflight = checked_process(
            [str(python_exe), "-I", "-B", str(out / "runtime" / "preflight.py"), "preparation"],
            cwd=python_root, env=env,
        )
        if (preflight.get("status") != "verified"
                or preflight.get("python_root") != str(python_root)
                or preflight.get("profile") != str(profile)
                or Path(preflight.get("interpreter", "")).resolve() != python_exe):
            raise ValueError("Precontrole final incoherent.")
        return {
            "candidate": str(out), "profile": str(profile),
            "descriptor": str(descriptor), "resourceCount": final["resourceCount"],
            "pythonRoot": str(python_root), "replacements": replacements,
        }
    except BaseException:
        for destination in reversed(owned):
            shutil.rmtree(destination)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--_worker", help=argparse.SUPPRESS)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--pinned-candidate", type=Path)
    parser.add_argument("--aim-application", type=Path)
    parser.add_argument("--python", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    if args._worker is not None:
        result = worker(json.loads(args._worker))
    else:
        required = ["pinned_candidate", "aim_application", "python"]
        if not args.validate_only:
            required.extend(("out", "profile"))
        for name in required:
            if getattr(args, name) is None:
                parser.error("--" + name.replace("_", "-") + " requis")
        if args.validate_only:
            if args.out is not None or args.profile is not None:
                parser.error("--validate-only n'accepte aucune destination")
            result = validate(
                absolute_path(args.python), SOURCES, absolute_path(args.pinned_candidate),
                aim_application=absolute_path(args.aim_application),
            )
        else:
            result = prepare(args.out, args.profile, args.pinned_candidate,
                             args.aim_application, args.python)
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
