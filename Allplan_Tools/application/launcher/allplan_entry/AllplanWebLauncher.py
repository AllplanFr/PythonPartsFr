"""Thin PythonPart: one button opens the existing external launcher."""
import ctypes
import logging

import NemAll_Python_AllplanSettings as AllplanSettings
from CreateElementResult import CreateElementResult

from application.core.allplan.adapter import launch_from_allplan


def check_allplan_version(_build_ele, version: float) -> bool:
    return version >= 2022.0 or int(version) == 99


def create_element(_build_ele, _doc):
    return CreateElementResult([])


def on_control_event(build_ele, event_id: int, _doc) -> bool:
    if event_id != 1001:
        return False
    try:
        kind = build_ele.InstallationType.value
        if kind not in ("Standard", "Verification"):
            raise ValueError("Choisir explicitement Standard ou Verification.")
        diagnostics = launch_from_allplan(
            AllplanSettings,
            verification_version=kind == "Verification",
        )
        if diagnostics:
            ctypes.windll.user32.MessageBoxW(
                None, "\n".join(diagnostics), "Launcher Allplan - diagnostics", 0x30,
            )
    except (OSError, ValueError, AttributeError, RuntimeError) as exc:
        logging.getLogger(__name__).error("Echec du PythonPart launcher : %s", type(exc).__name__)
        ctypes.windll.user32.MessageBoxW(
            None, f"Impossible d'ouvrir le launcher : {exc}", "Launcher Allplan", 0x10,
        )
    return False
