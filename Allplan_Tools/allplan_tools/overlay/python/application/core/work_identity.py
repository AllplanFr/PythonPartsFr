"""Verify the explicit work-copy inventory; AIM pins remain independently checked."""
import hashlib
import json
from pathlib import Path


def verify_work_copy():
    root = Path(__file__).resolve().parents[3]
    manifest = json.loads((root / "work-manifest.json").read_text(encoding="utf-8"))
    if manifest["schema"] != "allplan-tools-launcher-work/1":
        raise ValueError("Identite de copie de travail invalide.")
    from .plugin_icons import optional_icon_names
    optional = {"python/" + name for name in optional_icon_names()}
    for relative in manifest["files"]:
        palette = Path(relative)
        if palette.suffix == ".pyp" and palette.parts[0] in ("library", "template"):
            optional.update(palette.with_name(palette.stem + suffix + ".png").as_posix()
                            for suffix in ("", "_24", "_128"))
    actual = {
        p.relative_to(root).as_posix()
        for p in (root / "python").rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    }
    if actual - optional != {name for name in manifest["files"]
                             if name.startswith("python/")} - optional:
        raise ValueError("Inventaire Python de travail different.")
    for relative, expected in manifest["files"].items():
        if relative in optional:
            continue
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("Copie de travail modifiee : " + relative)
