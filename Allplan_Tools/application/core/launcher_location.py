"""Machine-generated external launcher location for the Allplan PythonPart."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile

from .resources import PACKAGE_ROOT


def location_file() -> Path:
    return Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher" / "launcher.json"


def register_launcher() -> None:
    target = location_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "python_executable": sys.executable,
        "package_parent": str(PACKAGE_ROOT.parent),
        "frozen": bool(getattr(sys, "frozen", False)),
    }
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent, delete=False,
            prefix=".launcher-", suffix=".tmp",
        ) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def registered_command() -> tuple[list[str], Path]:
    target = location_file()
    if not target.is_file():
        raise FileNotFoundError(
            "Launcher non enregistre. Ouvrez le launcher une premiere fois depuis son raccourci."
        )
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
        executable = Path(data["python_executable"])
        parent = Path(data["package_parent"])
        frozen = data["frozen"]
        if (type(frozen) is not bool or not executable.is_absolute()
                or not executable.is_file() or not parent.is_absolute() or not parent.is_dir()):
            raise ValueError("Emplacement du launcher invalide.")
        if not frozen and not (parent / "application" / "__main__.py").is_file():
            raise FileNotFoundError("Le package du launcher est absent.")
        return ([str(executable)] if frozen else [str(executable), "-m", "application"]), parent
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(
            "Emplacement du launcher illisible. Ouvrez de nouveau son raccourci."
        ) from exc
