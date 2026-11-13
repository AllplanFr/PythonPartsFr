"""One launcher for source, installed GUI entry point and Allplan."""
import argparse
import logging
import os
from pathlib import Path
import subprocess
import sys

from application.core.catalog import PLUGINS, resolve_plugin, resolve_url
from application.core.context import (
    LaunchContext, add_context_arguments, context_from_arguments,
)
from application.core.launching import (
    inspect_context, plugin_options_to_arguments, resolve_context, validate_resources,
)
from application.core.resources import PACKAGE_ROOT, resource_path
from application.core.runtime import PluginServices, create_app
from application.core.errors import LaunchError, notify_launch_error
from application.core.aim_instance import AimAlreadyOpen


class LauncherParser(argparse.ArgumentParser):
    def error(self, message):
        if sys.stderr is not None:
            self.print_usage(sys.stderr)
            print(f"{self.prog}: error: {message}", file=sys.stderr)
        raise LaunchError(message)


def create_parser() -> argparse.ArgumentParser:
    parser = LauncherParser(description="Launcher commun des plugins Allplan (Windows)")
    parser.add_argument("app_id", nargs="?", help=", ".join(PLUGINS))
    add_context_arguments(parser)
    parser.add_argument("--paths", type=Path)
    added = set()
    for plugin in PLUGINS.values():
        for name, description in plugin.path_options.items():
            if name not in added:
                parser.add_argument("--" + name.replace("_", "-"), type=Path, help=description)
                added.add(name)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--protocol-control-test", action="store_true",
                        help="Controle RC1 local uniquement (WinForms/WebView2 confine).")
    parser.add_argument("--protocol-smartcatalog-test", action="store_true",
                        help="Preparation distante SmartCatalog RC1 (bloquee sans preuves verifiees).")
    return parser


def plugin_options(args: argparse.Namespace) -> dict:
    names = {name for plugin in PLUGINS.values() for name in plugin.path_options}
    return {name: getattr(args, name) for name in names if getattr(args, name) is not None}


def detect_allplan(args):
    from application.core.allplan.paths import AllplanPaths
    return AllplanPaths.from_dict(inspect_context(
        context_from_arguments(args), paths_file=args.paths, timeout=args.timeout,
    ))


def run_app(plugin, context: LaunchContext, args) -> None:
    if plugin.id == "information_manager":
        from application.core.aim_instance import AimInstance
        with AimInstance(inherit=True):
            return _run_app(plugin, context, args)
    return _run_app(plugin, context, args)


def _run_app(plugin, context: LaunchContext, args) -> None:
    import webview

    root = Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher"
    app_root = root / plugin.id / (context.allplan_version or "standalone")
    app_root /= "verification" if context.verification_version else "standard"
    data_dir, profile_dir = app_root / "data", app_root / "profile"
    data_dir.mkdir(parents=True, exist_ok=True)
    profile_dir.mkdir(parents=True, exist_ok=True)
    app = create_app(plugin, data_dir, context, plugin_options(args), PluginServices(args.timeout))
    if plugin.id == "vob_editor":
        from .vob_online import run
        run(
            app, app_root, profile_dir,
            coordinated_revision="58a9c1f6047015778ccddb6fb40e98e19008b56d",
        )
        return
    if getattr(app, "_requires_protected_host", False):
        if plugin.id == "information_manager":
            from .aim_local_delivery import run_installed
            run_installed(app, app_root)
            return
        raise RuntimeError(
            "AIM projet : lancement distant bloque avant exposition de l'API. "
            "Protections natives prealables et contrat frontend a raccorder."
        )
    webview.settings["IGNORE_SSL_ERRORS"] = False
    if hasattr(app, "_initial_preferences"):
        app._initial_preferences()
    window = webview.create_window(
        title=plugin.name, url=plugin.url, js_api=app, width=1280, height=850,
        min_size=(800, 600),
    )
    if window is None:
        raise RuntimeError("La fenetre de l'application n'a pas pu etre creee.")
    if hasattr(app, "_attach_window"):
        app._attach_window(window)
    if hasattr(app, "_close"):
        window.events.closed += app._close

    def on_loaded():
        try:
            current = resolve_url(window.get_current_url())
        except ValueError:
            logging.getLogger(__name__).warning("Navigation sans injection : site non enregistre.")
            return
        if current.id != plugin.id:
            return
        try:
            common = resource_path(PACKAGE_ROOT / "core", "resources\\bridge.js")
            specific = resource_path(plugin.package_dir, plugin.script)
            window.evaluate_js(common.read_text(encoding="utf-8") + "\n"
                               + specific.read_text(encoding="utf-8"))
            if hasattr(app, "_on_loaded"):
                app._on_loaded(window)
        except (OSError, ValueError, RuntimeError, webview.errors.JavascriptException) as exc:
            logging.getLogger(__name__).error(
                "Initialisation du pont impossible : %s", type(exc).__name__,
            )
            notify_launch_error(
                f"Le pont de {plugin.name} n'a pas pu etre initialise. Consultez le journal."
            )

    window.events.loaded += on_loaded
    webview.start(gui="edgechromium", debug=False, private_mode=False,
                  storage_path=str(profile_dir))


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments[:1] == ["--inspect-allplan"]:
        from application.core.allplan.inspection import main as inspect_main
        return inspect_main(arguments[1:])
    parser = create_parser()
    if "--installation-id" in arguments or any(v.startswith("--installation-id=") for v in arguments):
        parser.error("--installation-id supprime : utiliser --allplan-version et, si necessaire, --verification-version.")
    args = parser.parse_args(arguments)
    if args.protocol_control_test and args.protocol_smartcatalog_test:
        parser.error("Les modes RC1 local et SmartCatalog distant sont exclusifs.")
    if sys.platform != "win32":
        parser.error("Plateforme non prise en charge : Windows uniquement (y compris Windows emule).")
    if not 0 < args.timeout <= 300:
        parser.error("Le timeout doit etre compris entre 0 et 300 secondes.")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    from application.core.logging_setup import set_diagnostic
    try:
        if args.protocol_smartcatalog_test:
            if args.app_id != "smartcatalog":
                raise ValueError(
                    "--protocol-smartcatalog-test exige uniquement app_id smartcatalog."
                )
            options = plugin_options(args)
            if (options or args.paths is not None or args.allplan_version is not None
                    or args.verification_version or args.country is not None
                    or args.allplan_language is not None or args.diagnostic
                    or args.origin != "standalone" or args.catalog_user_path is not None
                    or args.project_path is not None or args.timeout != 15
                    or any(getattr(args, f"{name.lower()}_path") is not None
                           for name in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP"))):
                raise ValueError(
                    "La recette distante RC1 refuse le contexte, les chemins et "
                    "les options metier."
                )
            from .smartcatalog_remote_control import require_reviewed_recipe
            require_reviewed_recipe()
            return 0
        set_diagnostic(args.diagnostic)
        context = context_from_arguments(args)
        options = plugin_options(args)
        if args.protocol_control_test:
            if args.app_id is None:
                raise ValueError("--protocol-control-test necessite un app_id.")
            if options or args.paths is not None:
                raise ValueError("Le controle RC1 refuse les options et fichiers metier.")
            plugin = resolve_plugin(args.app_id)
            from .protocol_control import run_control_test
            run_control_test(plugin.id, context)
            return 0
        if args.app_id is None:
            if options:
                raise ValueError("Les options propres a un plugin necessitent son identifiant.")
            if args.paths is not None:
                context = resolve_context(context, paths_file=args.paths, timeout=args.timeout)
            from .selector import show_selector
            show_selector(context, timeout=args.timeout)
            return 0
        plugin = resolve_plugin(args.app_id)
        validate_resources(plugin)
        plugin_options_to_arguments(plugin, options)
        context = resolve_context(context, paths_file=args.paths, timeout=args.timeout)
        plugin.validate(context)
        run_app(plugin, context, args)
        return 0
    except AimAlreadyOpen as exc:
        logging.getLogger(__name__).info("AIM already_open")
        notify_launch_error(str(exc))
        return 0
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError,
            ImportError, AttributeError, RuntimeError) as exc:
        logging.getLogger(__name__).exception("Lancement impossible : %s", type(exc).__name__)
        parser.error(str(exc))


def entrypoint(*, register_location: bool = True) -> int:
    arguments = sys.argv[1:]
    if sys.platform == "win32" and arguments[:1] != ["--inspect-allplan"]:
        from application.core.launcher_location import register_launcher
        from application.core.logging_setup import configure_logging
        configure_logging()
        from application.core.logging_setup import session_log_path
        log_path = session_log_path()
        logging.getLogger(__name__).info(
            "Launcher process identity: pid=%d executable=%r entrypoint=%r "
            "package_root=%r cwd=%r argv=%r session_log=%r",
            os.getpid(), sys.executable, __file__, str(PACKAGE_ROOT),
            os.getcwd(), arguments, str(log_path) if log_path is not None else None,
        )
        if register_location:
            try:
                register_launcher()
            except OSError as exc:
                logging.getLogger(__name__).warning(
                    "Enregistrement du launcher impossible : %s", type(exc).__name__,
                )
    try:
        return main(arguments)
    except LaunchError as exc:
        notify_launch_error(f"Impossible d'ouvrir l'application.\n{exc.message}")
        return 2
