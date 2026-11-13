"""Test-only child preflight. Never opens a manager or changes project data."""
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile


CONFIG = json.loads((Path(__file__).resolve().parents[1] / "runtime.json").read_text(encoding="utf-8"))
ROOT = Path(CONFIG["pythonRoot"]).parent
PYTHON_ROOT = Path(CONFIG["pythonRoot"])
PROFILE = Path(CONFIG["profile"])
REVISION = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
TREE = "a5f51ec092b2dabf2796ea67628d05d859ce5d08"
SHA256 = "6452e7d92e24f03d8c1ab738eaeeeb1380cca35c384a4293329348f0add97b52"
PYTHON_STATE = "aim-working-state-0b05206"
ARCHIVE = Path(CONFIG["pinnedCandidate"]) / "AIM_candidate_0b05206.zip"


def verify(token):
    if Path(os.environ["LOCALAPPDATA"]).resolve() != PROFILE:
        raise ValueError("Profil enfant incorrect.")
    if not (PYTHON_ROOT / "launcher.py").is_file():
        raise FileNotFoundError("Launcher candidat absent.")
    sys.path.insert(0, str(PYTHON_ROOT))
    from application.core.work_identity import verify_work_copy
    verify_work_copy()
    from application.launcher.aim_local_delivery import delivery_pin, local_resources, verify_python
    descriptor = PROFILE / "AllplanWebLauncher" / "information_manager" / "local-delivery.json"
    expected = {
        "schema": "aim-local-installation/1", "revision": REVISION, "tree": TREE,
        "sha256": SHA256, "pythonState": PYTHON_STATE, "artifact": str(ARCHIVE),
    }
    if json.loads(descriptor.read_text(encoding="utf-8")) != expected:
        raise ValueError("Descripteur candidat incorrect.")
    pin = delivery_pin(REVISION)
    if (pin is None or pin["tree"] != TREE or pin["sha256"] != SHA256
            or pin["python_state"] != PYTHON_STATE):
        raise ValueError("Epingles candidates incorrectes.")
    if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != SHA256:
        raise ValueError("Empreinte archive incorrecte.")
    verify_python(REVISION)
    manifest, resources = local_resources(ARCHIVE, expected_sha256=SHA256, revision=REVISION)
    if manifest.get("revision") != REVISION or manifest.get("trackedChangesAtBuild") is not False:
        raise ValueError("Identite du build incorrecte.")
    with zipfile.ZipFile(ARCHIVE) as archive:
        artifact = json.loads(archive.read("artifact-manifest.json"))
    if (artifact.get("schema") != "aim-local-recipe/1"
            or artifact.get("revision") != REVISION or artifact.get("tree") != TREE):
        raise ValueError("Identite de l'inventaire incorrecte.")
    module_paths = {}
    for name, module in tuple(sys.modules.items()):
        if name == "application" or name.startswith("application."):
            location = getattr(module, "__file__", None)
            if not location or not Path(location).resolve().is_relative_to(PYTHON_ROOT):
                raise RuntimeError("Module applicatif hors candidate : " + name)
            module_paths[name] = str(Path(location).resolve())
    return {
        "status": "verified", "token": token, "revision": REVISION, "tree": TREE,
        "archive_sha256": SHA256, "resource_count": len(resources),
        "profile": str(PROFILE), "python_root": str(PYTHON_ROOT),
        "interpreter": sys.executable, "module_paths": module_paths,
        "resource_provenance": "local reconstruction; pinned hashes verified",
        "lovable_archive_obtained": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify(sys.argv[1]), ensure_ascii=True))
