"""Locations of shipped code/resources, never of mutable user data."""
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = PACKAGE_ROOT / "plugins"


def resource_path(package_dir: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not relative.strip():
        raise ValueError("Une ressource doit etre relative a son package.")
    resolved = (package_dir / path).resolve()
    try:
        resolved.relative_to(package_dir.resolve())
    except ValueError as exc:
        raise ValueError("La ressource sort de son package.") from exc
    return resolved
