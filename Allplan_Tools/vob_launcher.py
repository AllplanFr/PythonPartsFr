"""VOB-only source entry point, without replacing the shared launcher registration."""
from inspect import signature
import json
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent))
from application.launcher.main import entrypoint


if __name__ == "__main__":
    configuration = Path(__file__).resolve().with_name("vob-local-delivery.json")
    if configuration.is_file() and not any(
            value == "--vob-local-package" or value.startswith("--vob-local-package=")
            for value in sys.argv[1:]):
        info = json.loads(configuration.read_text(encoding="utf-8"))
        if info != {"schema": "vob-local-installation/1", "archive": "vob-local-package.zip"}:
            raise ValueError("Invalid local VOB delivery configuration.")
        sys.argv.extend(["--vob-local-package",
                         str(configuration.with_name(info["archive"]))])
    sys.argv.insert(1, "vob_editor")
    if "register_location" in signature(entrypoint).parameters:
        raise SystemExit(entrypoint(register_location=False))
    raise SystemExit(entrypoint())
