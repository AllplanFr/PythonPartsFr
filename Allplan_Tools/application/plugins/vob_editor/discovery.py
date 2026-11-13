"""Adapt the installation inventory to VOB's year-indexed resource model."""
import json
import logging
import subprocess
import sys

from application.core.allplan.paths import AllplanPaths, is_supported_version
from application.core.launching import inspection_command


def detect_allplan_versions(args, active_paths):
    command = inspection_command() + ["--list-paths", "--worker"]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=args.timeout,
        )
        payload = json.loads(result.stdout)
        if result.returncode or not payload.get("ok"):
            raise ValueError(payload.get("error", "Decouverte impossible."))
        candidates = {}
        for item in payload["data"]["installations"]:
            state = AllplanPaths.from_dict(item)
            if is_supported_version(state.version) and state.version != active_paths.version:
                candidates.setdefault(state.version, []).append(state)
        contexts = {}
        for version, states in candidates.items():
            if len(states) == 1:
                contexts[version] = states[0]
            else:
                print(f"Allplan {version} : plusieurs installations ; "
                      "ouvrir explicitement celle souhaitee dans le launcher.", file=sys.stderr)
        for diagnostic in payload["data"].get("diagnostics", []):
            print(diagnostic, file=sys.stderr)
        return contexts
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError) as exc:
        logging.getLogger(__name__).warning(
            "Decouverte des versions impossible : %s", type(exc).__name__,
        )
        print(f"Decouverte des autres versions Allplan impossible : {exc}", file=sys.stderr)
        return {}
