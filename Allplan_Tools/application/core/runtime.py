"""Lazy construction of the selected plugin; discovery never uses this module."""
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from typing import Callable

from .catalog import Plugin
from .context import LaunchContext


@dataclass(frozen=True)
class PluginServices:
    timeout: float = 15


def load_callable(plugin: Plugin, target: str) -> Callable:
    module_name, name = target.split(":")
    module = import_module(f"application.plugins.{plugin.id}.{module_name}")
    function = getattr(module, name)
    if not callable(function):
        raise TypeError(f"Le point d'entree de {plugin.name} n'est pas appelable.")
    return function


def create_app(
    plugin: Plugin, data_dir: Path, context: LaunchContext,
    options: dict, services: PluginServices,
):
    app = load_callable(plugin, plugin.entrypoint)(data_dir, context, options, services)
    app._set_launch_context(context)
    app.title = plugin.name
    app.canonical_url = plugin.url
    app.script_name = plugin.script
    return app
