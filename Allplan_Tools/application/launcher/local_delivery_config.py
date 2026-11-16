"""Resolve explicit per-assembly local delivery selection, never an online fallback."""
import json
from pathlib import Path


def selected_package(app_id, explicit=None):
    if app_id != "smartcatalog":
        raise ValueError("Unsupported local delivery configuration.")
    if explicit is not None:
        return Path(explicit)
    root = Path(__file__).resolve().parents[2]
    configuration = root / "smartcatalog-local-delivery.json"
    if not configuration.is_file():
        return None
    info = json.loads(configuration.read_text(encoding="utf-8"))
    if info != {"schema": "smartcatalog-local-installation/1",
                "archive": "smartcatalog-local-package.zip"}:
        raise ValueError("Invalid local SmartCatalog delivery configuration.")
    return root / info["archive"]
