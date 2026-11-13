"""Small local WebView selector; launching and validation stay in services."""
from dataclasses import replace
from html import escape
import json
import logging
import subprocess

from application.core.context import LaunchContext
from application.core.catalog import CATALOG, PLUGINS
from application.core.launching import inspection_command, launch_plugin
from application.core.resources import PACKAGE_ROOT, resource_path
from application.core.aim_instance import AimAlreadyOpen
from application.core.test_process import console_options, process_log_directory


def discover_installations(timeout: float) -> tuple[list[dict], list[str]]:
    try:
        result = subprocess.run(
            inspection_command() + ["--list", "--worker"], capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=timeout,
            cwd=str(PACKAGE_ROOT.parent),
            **console_options(),
        )
        data = json.loads(result.stdout)
        if result.returncode or not data.get("ok"):
            raise ValueError(data.get("error", "Inventaire Allplan indisponible."))
        return data["data"]["installations"], data["data"].get("diagnostics", [])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        logging.getLogger(__name__).warning("Inventaire Allplan indisponible : %s", type(exc).__name__)
        return [], [f"Inventaire Allplan indisponible : {exc}"]


class SelectorApi:
    def __init__(self, context: LaunchContext, timeout: float = 15):
        self._context = context
        self._timeout = timeout

    def launch(self, plugin_id: str, year: str, verification: bool, country: str) -> dict:
        try:
            same_installation = (
                (year.strip() or None) == self._context.allplan_version
                and verification == self._context.verification_version
            )
            context = replace(
                self._context, allplan_version=year.strip() or None,
                verification_version=verification, country=country.strip() or None,
                paths=self._context.paths if same_installation else {},
                catalog_user_path=self._context.catalog_user_path if same_installation else None,
                project_path=self._context.project_path if same_installation else None,
                allplan_language=self._context.allplan_language if same_installation else None,
            )
            launch_plugin(plugin_id, context, timeout=self._timeout)
            return {"ok": True}
        except AimAlreadyOpen as exc:
            logging.getLogger(__name__).info("AIM already_open")
            return {"ok": False, "error": str(exc)}
        except (OSError, ValueError, subprocess.SubprocessError, ImportError,
                AttributeError, TypeError, RuntimeError) as exc:
            logging.getLogger(__name__).error("Selection impossible : %s", type(exc).__name__)
            message = str(exc) if isinstance(exc, (ValueError, OSError)) else (
                "Ce plugin n'a pas pu etre initialise. Les autres applications restent accessibles."
            )
            return {"ok": False, "error": message + "\nJournal : " + str(process_log_directory())}


def show_selector(context: LaunchContext, *, timeout: float = 15) -> None:
    import webview
    installations, diagnostics = discover_installations(timeout)
    options = ['<option value="">Choisir explicitement une installation (facultatif)</option>']
    for item in installations:
        year = item["version"]
        verification = item["verification_version"]
        kind = "verification" if verification else "standard"
        options.append(f'<option value="{escape(year)}:{int(verification)}">'
                       f'Allplan {escape(year)} - {kind}</option>')
    cards = []
    for plugin in PLUGINS.values():
        reason = plugin.availability()
        disabled = ' disabled data-unavailable="true"' if reason else ""
        icon = ""
        from application.core.plugin_icons import icon_path
        path = icon_path(plugin)
        if path is not None:
            import base64
            import mimetypes
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            icon = f'<img alt="" width="32" src="data:{escape(mime)};base64,{encoded}">'
        cards.append(
            f'<article>{icon}<h2>{escape(plugin.name)}</h2><p>{escape(plugin.description)}</p>'
            f'<button data-plugin="{plugin.id}"{disabled}>Ouvrir</button>'
            + (f'<p class="unavailable">{escape(reason)}</p>' if reason else "")
            + "</article>"
        )
    for item in CATALOG.unavailable:
        cards.append(f'<article><h2>{escape(item.name)}</h2><button disabled>Indisponible</button>'
                     f'<p class="unavailable">{escape(item.reason)}</p></article>')
    buttons = "".join(cards)
    html = resource_path(PACKAGE_ROOT / "launcher", "resources\\selector.html").read_text(encoding="utf-8")
    for marker, value in (
        ("OPTIONS", "".join(options)), ("YEAR", escape(context.allplan_version or "", quote=True)),
        ("CHECKED", "checked" if context.verification_version else ""),
        ("COUNTRY", escape(context.country or "", quote=True)), ("BUTTONS", buttons),
        ("DIAGNOSTICS", escape("\n".join(diagnostics))),
    ):
        html = html.replace(marker, value)
    webview.settings["IGNORE_SSL_ERRORS"] = False
    window = webview.create_window("Launcher Allplan", html=html, js_api=SelectorApi(context, timeout),
                                   width=760, height=760, min_size=(600, 650))
    from application.core.plugin_icons import bind_window_icon
    bind_window_icon(window)
    webview.start(gui="edgechromium", debug=False)
