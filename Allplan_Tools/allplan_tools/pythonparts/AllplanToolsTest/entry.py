"""Shared dependency-free Allplan host boundary, configured outside wrappers."""
import ctypes
import json
import logging
import math
import os
from pathlib import Path
import subprocess
import sys
import traceback
from threading import Lock
from time import monotonic
from uuid import uuid4

from CreateElementResult import CreateElementResult


LOGGER = logging.getLogger(__name__)
TARGETS = ("home", "information_manager", "smartcatalog", "vob_editor")
_GUARDS = {target: Lock() for target in TARGETS}
_PENDING = {}


def check_allplan_version(_build_ele, version):
    try:
        numeric = float(version)
    except (TypeError, ValueError):
        return False
    return math.isfinite(numeric) and (numeric >= 2022 or numeric == 99)


def create_element(_build_ele, _doc):
    return CreateElementResult([])


def create_launcher(target, build_ele, script_object_data):
    """Only start_input may attempt automatic launch; preview/execute never do."""
    from BaseScriptObject import BaseScriptObject
    from ScriptObjectInteractors.OnCancelFunctionResult import OnCancelFunctionResult

    class LauncherScriptObject(BaseScriptObject):
        def __init__(self):
            super().__init__(script_object_data)
            self._automatic_attempted = False
            self._automatic_guard = Lock()

        def start_input(self):
            with self._automatic_guard:
                if self.is_only_update or self._automatic_attempted:
                    return
                self._automatic_attempted = True
            control_event(target, build_ele, 1001, self.document)

        def execute(self):
            return create_element(build_ele, self.document)

        def on_control_event(self, event_id):
            return control_event(target, build_ele, event_id, self.document)

        def on_cancel_function(self):
            return OnCancelFunctionResult.CANCEL_INPUT

    return LauncherScriptObject()


def _launch_in_progress(target):
    pending = _PENDING.get(target)
    if pending is None:
        return False
    process, result, token, started = pending
    data = None
    if result.is_file():
        try:
            data = json.loads(result.read_text(encoding="utf-8"))
            if (not isinstance(data, dict) or data.get("token") != token
                    or data.get("status") not in ("accepted", "failed")):
                raise ValueError("Resultat de demarrage non correle.")
        except (OSError, ValueError):
            with result.with_suffix(".log").open("a", encoding="utf-8") as output:
                traceback.print_exc(file=output)
            data = None
    exit_code = process.poll()
    if data is not None or exit_code is not None:
        if data is None:
            _display_error(
                RuntimeError("Demande precedente terminee sans resultat de demarrage"
                             " (code " + str(exit_code) + "). Nouvelle tentative manuelle."),
                result.with_suffix(".log"),
            )
        del _PENDING[target]
        return False
    if monotonic() - started > 90:
        LOGGER.warning("Demarrage enfant sans resultat apres 90 s ; journal : %s", result)
        ctypes.windll.user32.MessageBoxW(
            None, "Demarrage toujours sans resultat. Aucune nouvelle demande envoyee."
            "\nJournal : " + str(result.with_suffix(".log")),
            "Allplan Tools - demarrage en cours", 0x30,
        )
    return True


def _config():
    location = json.loads(Path(__file__).with_name("entry-config.json").read_text(encoding="utf-8"))
    root = Path(location["testRoot"])
    config = json.loads((root / "runtime.json").read_text(encoding="utf-8"))
    if config["schema"] != "allplan-tools-test-runtime/1":
        raise ValueError("Configuration de test invalide.")
    for key in ("pythonRoot", "profile", "pythonExecutable"):
        if not Path(config[key]).is_absolute():
            raise ValueError("Chemin configure non absolu : " + key)
    return root, config


def control_event(target, build_ele, event_id, _doc):
    if event_id != 1001:
        return False
    if target not in _GUARDS:
        raise ValueError("Identifiant de plugin non enregistre.")
    guard = _GUARDS[target]
    if not guard.acquire(blocking=False):
        LOGGER.info("Demande ignoree : lancement en cours pour %s", target)
        return False
    try:
        if not _launch_in_progress(target):
            _launch(target)
    except (OSError, ValueError, TypeError) as exc:
        pending = _PENDING.get(target)
        _display_error(exc, pending[1].with_suffix(".log") if pending else None)
    finally:
        guard.release()
    return False


def _launch(target):
    log = None
    try:
        root, config = _config()
        logdir = Path(config["profile"]) / "AllplanWebLauncher" / "logs"
        logdir.mkdir(parents=True, exist_ok=True)
        token = uuid4().hex
        log = logdir / ("allplan-entry-" + token + ".log")
        result = log.with_suffix(".json")
        python_root = Path(config["pythonRoot"]).resolve()
        loaded = sys.modules.get("application")
        if loaded is not None:
            path = getattr(loaded, "__file__", None)
            if not path or not Path(path).resolve().is_relative_to(python_root):
                raise RuntimeError("Ancien package application charge : redemarrer Allplan.")
        if str(python_root) not in sys.path:
            sys.path.insert(0, str(python_root))
        from application.core.allplan.adapter import context_from_allplan
        from application.core.context import context_to_arguments
        from application.core.test_process import console_options
        import NemAll_Python_AllplanSettings as settings
        context, _diagnostics = context_from_allplan(
            settings, verification_version=False,
        )
        runner = root / "runtime" / "runner.py"
        interpreter = Path(config["pythonExecutable"])
        if not runner.is_file() or not interpreter.is_file():
            raise FileNotFoundError("Environnement de test absent.")
        environment = dict(os.environ)
        environment["LOCALAPPDATA"] = config["profile"]
        environment["ALLPLAN_TOOLS_ENTRY_TOKEN"] = token
        command = [str(interpreter), "-I", str(runner), "--target", target]
        command.extend(context_to_arguments(context))
        with log.open("ab", buffering=0) as output:
            process = subprocess.Popen(
                command, cwd=str(python_root), env=environment, shell=False,
                stdout=output, stderr=subprocess.STDOUT, **console_options(),
            )
        _PENDING[target] = (process, result, token, monotonic())
    except Exception as exc:
        _display_error(exc, log)


def _display_error(exc, log):
    details = str(exc) + "\n" + traceback.format_exc()
    journal_failed = False
    if log is not None:
        try:
            with log.open("a", encoding="utf-8") as output:
                output.write(details)
        except OSError as log_error:
            journal_failed = True
            details += "\nEchec du journal : " + str(log_error)
    ctypes.windll.user32.MessageBoxW(
        None, str(exc) + ("\nJournal : " + str(log) if log else "")
        + ("\n" + details if log is None or journal_failed else ""),
        "Allplan Tools - lancement refuse", 0x10,
    )
