"""Allplan boundary: documented APIs only, with no external dependencies."""
from __future__ import annotations

import logging
import re
from typing import Any

from application.core.context import LaunchContext, normalize_version
from application.core.launching import open_registered_launcher


LOGGER = logging.getLogger(__name__)


def context_from_allplan(
    settings: Any, *, verification_version: bool | None,
) -> tuple[LaunchContext, list[str]]:
    if verification_version is None:
        raise ValueError(
            "Type d'installation non determine par l'API : choisir Standard ou Verification dans la palette."
        )
    release = str(settings.AllplanVersion.MainReleaseName()).strip()
    match = re.fullmatch(r"([2-9]\d{3}|99)(?:\.\d+)?", release)
    if not match:
        raise ValueError("Version Allplan invalide : " + release)
    version = normalize_version(match.group(1))
    paths = {}
    diagnostics = []
    # GetCurPrjPath is the current project, NOT the PRJ installation root.
    methods = {
        "ETC": "GetEtcPath", "PRG": "GetPrgPath", "STD": "GetStdPath",
        "USR": "GetUsrPath", "TMP": "GetTmpPath",
    }
    for name, method in methods.items():
        try:
            raw = getattr(settings.AllplanPaths, method)()
            paths[name] = LaunchContext._path(raw)
        except (AttributeError, OSError, RuntimeError, ValueError) as exc:
            LOGGER.warning("Chemin Allplan %s indisponible : %s", name, type(exc).__name__)
            diagnostics.append(f"Chemin Allplan {name} indisponible ({type(exc).__name__}).")
    project = None
    try:
        raw = settings.AllplanPaths.GetCurPrjPath()
        if raw:
            project = LaunchContext._path(raw)
    except (AttributeError, OSError, RuntimeError, ValueError) as exc:
        LOGGER.warning("Projet Allplan indisponible : %s", type(exc).__name__)
        diagnostics.append(f"Projet courant indisponible ({type(exc).__name__}).")
    return LaunchContext(
        allplan_version=version, verification_version=verification_version,
        paths=paths, project_path=project, origin="allplan",
    ), diagnostics


def launch_from_allplan(
    settings: Any, *, verification_version: bool | None,
) -> list[str]:
    context, diagnostics = context_from_allplan(
        settings, verification_version=verification_version,
    )
    open_registered_launcher(context)
    return diagnostics
