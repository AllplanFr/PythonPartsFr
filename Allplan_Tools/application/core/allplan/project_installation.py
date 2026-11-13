"""Match projects to complete, single-installation contexts; no name inference."""
from dataclasses import replace
import json
from pathlib import Path
import subprocess

from application.core.context import LaunchContext
from application.core.launching import inspection_command, ROOT
from .paths import AllplanPaths


def discover_project_installations(timeout: float = 15):
    result = subprocess.run(
        inspection_command() + ["--list-paths", "--worker"],
        capture_output=True, text=True, encoding="utf-8", errors="strict",
        timeout=timeout, cwd=str(ROOT),
    )
    payload = json.loads(result.stdout)
    if result.returncode or not payload.get("ok"):
        raise ValueError(payload.get("error", "Decouverte Allplan impossible."))
    contexts = []
    for raw in payload["data"]["installations"]:
        state = AllplanPaths.from_dict(raw)
        contexts.append(LaunchContext(
            allplan_version=state.version,
            verification_version=state.verification_version,
            country=state.country or None, allplan_language=state.language,
            paths={key: value for key, value in state.paths.items() if value is not None},
        ))
    return contexts, payload["data"].get("diagnostics", [])


def project_installations(project: Path, active: LaunchContext, discovered):
    candidates = []
    # An explicitly resolved context is authoritative for its installation,
    # including supported path overrides; do not mix in discovered resource paths.
    for candidate in ([active] if active.allplan_version is not None else []) + list(discovered):
        if candidate.allplan_version is None or candidate.paths.get("PRJ") is None:
            continue
        if active.allplan_version is not None and (
            candidate.allplan_version != active.allplan_version
            or candidate.verification_version != active.verification_version
        ):
            continue
        if (candidate is not active and active.allplan_version == candidate.allplan_version
                and active.verification_version == candidate.verification_version
                and active.paths.get("PRJ") is not None):
            continue
        root = candidate.paths["PRJ"].resolve(strict=False)
        if project.parent != root:
            continue
        if any(
            entry.allplan_version == candidate.allplan_version
            and entry.verification_version == candidate.verification_version
            and entry.paths == candidate.paths
            for entry in candidates
        ):
            continue
        candidates.append(replace(candidate, project_path=project))
    return candidates
