"""Context resolution and process launching, independent of plugin interfaces."""
from __future__ import annotations

from dataclasses import replace
import json
import logging
from pathlib import Path
import subprocess
import sys
from typing import Mapping

from application.core.context import LaunchContext, context_to_arguments
from application.core.catalog import Plugin, resolve_plugin
from .resources import PACKAGE_ROOT
from .test_process import console_options, spawn_logged


LOGGER = logging.getLogger(__name__)
ROOT = PACKAGE_ROOT.parent


def launcher_command(
    entrypoint: Path | None = None, python_executable: Path | None = None,
) -> list[str]:
    if entrypoint is None:
        if not getattr(sys, "frozen", False):
            return [sys.executable, "-m", "application"]
        entrypoint = Path(sys.executable)
    entrypoint = Path(entrypoint)
    if not entrypoint.is_absolute() or not entrypoint.is_file():
        raise FileNotFoundError(f"Launcher absent : {entrypoint}")
    if entrypoint.suffix.lower() == ".py":
        interpreter = Path(python_executable or sys.executable)
        if not interpreter.is_absolute() or not interpreter.is_file():
            raise FileNotFoundError(f"Interpreteur du launcher absent : {interpreter}")
        return [str(interpreter), str(entrypoint)]
    if entrypoint.suffix.lower() != ".exe":
        raise ValueError("Le launcher doit etre un fichier .py ou .exe.")
    return [str(entrypoint)]


def inspection_command() -> list[str]:
    return launcher_command() + ["--inspect-allplan"]


def inspect_context(
    context: LaunchContext, *, paths_file: Path | None = None, timeout: float = 15,
) -> dict:
    command = inspection_command() + ["--worker"] + context_to_arguments(context)
    if paths_file is not None:
        command.extend(("--paths", str(paths_file)))
    result = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout,
        cwd=str(ROOT),
        **console_options(),
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        LOGGER.error("Detection Allplan invalide : stdout=%s\nstderr=%s",
                     result.stdout, result.stderr)
        raise ValueError("Reponse invalide du processus de detection Allplan.") from exc
    if result.returncode or not payload.get("ok"):
        LOGGER.error("Detection Allplan refusee : stdout=%s\nstderr=%s",
                     result.stdout, result.stderr)
        raise ValueError(payload.get("error", "Echec de la detection Allplan."))
    return payload["data"]


def resolve_context(
    context: LaunchContext, *, paths_file: Path | None = None, timeout: float = 15,
) -> LaunchContext:
    context = LaunchContext(**vars(context))
    LOGGER.info("Resolution du contexte : version=%s verification=%s origine=%s",
                context.allplan_version, context.verification_version, context.origin)
    if context.allplan_version is None:
        if paths_file is not None:
            raise ValueError("--paths necessite --allplan-version.")
        if context.country is None:
            LOGGER.warning("Pays non resolu : installation Allplan non identifiee.")
        return context
    data = inspect_context(context, paths_file=paths_file, timeout=timeout)
    for diagnostic in data.get("diagnostics", []):
        # Diagnostics can include local paths: present them, do not persist them.
        print(diagnostic, file=sys.stderr)
    return replace(context, country=data["country"] or None,
                   allplan_language=context.allplan_language or data.get("language"), paths={
        name: Path(raw) for name, raw in data["paths"].items() if raw is not None
    })


def plugin_options_to_arguments(plugin: Plugin, options: Mapping | None) -> list[str]:
    options = dict(options or {})
    if not options:
        return []
    if set(options) - plugin.path_options.keys():
        raise ValueError(f"Options non prises en charge pour {plugin.id}.")
    arguments = []
    for name, raw in options.items():
        path = LaunchContext._path(raw)
        if not path.is_file():
            raise FileNotFoundError(f"Fichier initial absent : {path}")
        arguments.extend(("--" + name.replace("_", "-"), str(path)))
    return arguments


def validate_resources(plugin: Plugin) -> None:
    if plugin.lifecycle == "construction":
        raise ValueError(f"{plugin.name} : plugin en construction.")
    reason = plugin.availability()
    if reason:
        raise FileNotFoundError(f"{plugin.name} indisponible : {reason}")


def launch_plugin(
    plugin_id: str, context: LaunchContext, plugin_options: Mapping | None = None,
    *, timeout: float = 15,
) -> subprocess.Popen:
    try:
        if sys.platform != "win32":
            raise OSError("Plateforme non prise en charge : Windows uniquement.")
        plugin = resolve_plugin(plugin_id)
        validate_resources(plugin)
        from .logging_setup import diagnostic_enabled
        context = replace(context, diagnostic=diagnostic_enabled())
        def spawn(lease=None):
            resolved = resolve_context(context, timeout=timeout)
            plugin.validate(resolved)
            command = (launcher_command() + [plugin.id] + context_to_arguments(resolved)
                       + plugin_options_to_arguments(plugin, plugin_options))
            if lease is not None:
                return spawn_logged(command, spawn=lease.spawn, cwd=str(ROOT), shell=False)
            return spawn_logged(command, cwd=str(ROOT), shell=False)

        if plugin.id == "information_manager":
            from .aim_instance import AimInstance
            with AimInstance() as lease:
                process = spawn(lease)
        else:
            process = spawn()
        LOGGER.info("Plugin lance : %s childPid=%s", plugin.id, process.pid)
        from .origin_project import remember_origin
        remember_origin(context)
        if plugin.id == "information_manager":
            from threading import Thread

            def observe_exit():
                LOGGER.info("AIM child_exit childPid=%s exitCode=%s", process.pid, process.wait())

            Thread(target=observe_exit, daemon=True).start()
        return process
    except (OSError, ValueError, subprocess.SubprocessError, ImportError,
            AttributeError, TypeError, RuntimeError) as exc:
        from .aim_instance import AimAlreadyOpen
        if isinstance(exc, AimAlreadyOpen):
            LOGGER.info("AIM already_open")
            raise
        LOGGER.error("Echec du lancement du plugin : %s", type(exc).__name__)
        raise


def open_launcher(
    context: LaunchContext, entrypoint: Path, python_executable: Path | None = None,
) -> subprocess.Popen:
    """Used by the PythonPart without importing pywebview or plugin classes."""
    if sys.platform != "win32":
        raise OSError("Plateforme non prise en charge : Windows uniquement.")
    try:
        command = launcher_command(entrypoint, python_executable) + context_to_arguments(context)
        return spawn_logged(command, cwd=str(entrypoint.parent), shell=False)
    except (OSError, ValueError) as exc:
        LOGGER.error("Echec d'ouverture du launcher : %s", type(exc).__name__)
        raise


def open_registered_launcher(context: LaunchContext) -> subprocess.Popen:
    from .launcher_location import registered_command
    try:
        if sys.platform != "win32":
            raise OSError("Plateforme non prise en charge : Windows uniquement.")
        command, directory = registered_command()
        return spawn_logged(
            command + context_to_arguments(context), cwd=str(directory), shell=False,
        )
    except (OSError, ValueError) as exc:
        LOGGER.error("Ouverture du launcher impossible : %s", type(exc).__name__)
        raise
