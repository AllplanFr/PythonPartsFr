"""Assemble the validated Allplan Tools test package from this repository.

The package is built in a new directory. Nothing is installed in Allplan.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
HOME_REVISION = "5dd43513ec8f170c8e8bc138f5fd2e0c82ae31ee"
AIM_REVISION = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
PYTHON_ITEMS = ("application", "inspect_allplan.py", "launcher.py", "requirements.txt",
                "pyproject.toml", "setup.py", "MANIFEST.in")
IGNORED = shutil.ignore_patterns("__pycache__", "*.pyc")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def git_head():
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def assemble(out, python_exe, profile, candidate):
    if out.exists() and any(out.iterdir()):
        raise SystemExit("Destination non vide : " + str(out))
    out.mkdir(parents=True, exist_ok=True)
    python = out / "python"
    python.mkdir()
    for name in PYTHON_ITEMS:
        source = REPO / name
        if source.is_dir():
            shutil.copytree(source, python / name, ignore=IGNORED)
        elif source.is_file():
            shutil.copy2(source, python / name)
    overlay = HERE / "overlay" / "python"
    overlaid = sorted(p.relative_to(overlay).as_posix() for p in overlay.rglob("*") if p.is_file())
    for relative in overlaid:
        target = python / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(overlay / relative, target)
    for name in ("runtime", "library", "template", "tools", "tests", "pythonparts"):
        shutil.copytree(HERE / name, out / name, ignore=IGNORED)
    for name in ("palette-normalization.json", "validated-icons-reference.json"):
        shutil.copy2(HERE / name, out / name)
    shutil.copytree(REPO / "artifacts" / "home-5dd43513",
                    out / ("home-" + HOME_REVISION[:7]))
    wrappers = out / "pythonparts" / "AllplanToolsTest"
    (wrappers / "entry-config.example.json").unlink()
    write_json(wrappers / "entry-config.json", {"testRoot": str(out)})
    write_json(out / "runtime.json", {
        "schema": "allplan-tools-test-runtime/1",
        "pythonRoot": str(python),
        "profile": str(profile),
        "pinnedCandidate": str(candidate),
        "homeDirectory": str(out / ("home-" + HOME_REVISION[:7])),
        "homeRevision": HOME_REVISION,
        "pythonExecutable": str(python_exe),
    })
    files = {}
    roots = [out / name for name in ("python", "runtime", "pythonparts", "library", "template")]
    for path in [p for root in roots for p in root.rglob("*") if p.is_file()] + [out / "runtime.json"]:
        files[path.relative_to(out).as_posix()] = sha256(path)
    write_json(out / "work-manifest.json", {
        "schema": "allplan-tools-launcher-work/1",
        "basePythonCommit": git_head(),
        "aimRevision": AIM_REVISION,
        "homeRevision": HOME_REVISION,
        "modifiedPythonFiles": overlaid,
        "files": dict(sorted(files.items())),
    })
    return len(files)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="nouveau dossier du package")
    parser.add_argument("--profile", required=True, type=Path, help="profil de donnees WebView2 AIM")
    parser.add_argument("--pinned-candidate", required=True, type=Path,
                        help="dossier de la candidate AIM epinglee")
    parser.add_argument("--python", type=Path, default=Path(sys.executable),
                        help="python.exe utilise pour les enfants")
    args = parser.parse_args(argv)
    count = assemble(args.out.resolve(), args.python.resolve(), args.profile.resolve(),
                     args.pinned_candidate.resolve())
    print("Package assemble :", args.out.resolve(), "(" + str(count) + " fichiers inventories)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
