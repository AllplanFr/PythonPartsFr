"""Actual WebView2 consumption of delivered home, with bounded failure injection."""
import json
import os
from pathlib import Path
import sys
import time
import traceback
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "runtime.json").read_text())
os.environ["LOCALAPPDATA"] = CONFIG["profile"]
sys.path.insert(0, str(ROOT / "runtime"))
import home_host as home

home._services()
from application.core.context import LaunchContext
from application.core import launching
from application.launcher.selector import SelectorApi
import bottle
import webview

MODE = sys.argv[1]
assert MODE in ("normal", "old-host", "icon-404", "both-404")
REPORT = {"mode": MODE}
STARTUP_CALLBACKS = []
REQUESTS = []
original_bottle = bottle.Bottle
original_info = home.HomeApi.get_home_info
original_start = webview.start
launches = []
api_info = []
original_launch_service = SelectorApi.launch.__globals__["launch_plugin"]


def refuse_launch(*args, **kwargs):
    launches.append([str(arg) for arg in args])
    raise AssertionError("Inspection must never launch a plugin")


def get_info(api):
    info = original_info(api)
    if MODE == "old-host":
        for plugin in info["plugins"]:
            plugin.pop("iconUrl", None)
    api_info.append(info)
    return info


def site_factory():
    site = original_bottle()
    @site.hook("before_request")
    def observe():
        path = bottle.request.path
        REQUESTS.append(path)
        if MODE in ("icon-404", "both-404") and path.startswith("/plugin-icons/"):
            raise bottle.HTTPError(404, "Controlled test-only icon response")
        if MODE == "both-404" and (
                path.endswith("/asc-B7ZbX14M.svg")
                or "/information-manager-border-" in path
                or "/vob-editor-border-" in path):
            raise bottle.HTTPError(404, "Controlled test-only fallback response")
    return site


def rows(window):
    return window.evaluate_js("""
        Array.from(document.querySelector('main ul')?.querySelectorAll('img') || [])
          .map(i=>({src:i.currentSrc || i.src, complete:i.complete,
                     width:i.naturalWidth, onError:i.onerror !== null}))
    """)


def inspect():
    window = webview.windows[0]
    try:
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            images = rows(window)
            if api_info and len(images) == 3 and all(i["complete"] for i in images):
                if MODE == "normal" and not all("/plugin-icons/" in i["src"] for i in images):
                    time.sleep(0.2)
                    continue
                if MODE != "normal" and any("/plugin-icons/" in i["src"] for i in images):
                    time.sleep(0.2)
                    continue
                break
            time.sleep(0.2)
        else:
            raise TimeoutError("Delivered icon rows did not reach expected state")
        assert "Applications" in window.evaluate_js("document.body.innerText")
        assert len(images) == 3
        if MODE == "normal":
            assert {i["src"].rsplit("/", 1)[-1] for i in images} == {
                plugin + ".png" for plugin in home.PLUGIN_IDS}
            assert all(i["width"] == 128 for i in images)
        else:
            assert all("/assets/" in i["src"] for i in images)
            if MODE == "both-404":
                assert all(i["width"] == 0 for i in images)
            else:
                assert all(i["width"] > 0 for i in images)
        counts = {path: REQUESTS.count(path) for path in set(REQUESTS)}
        time.sleep(2)
        assert counts == {path: REQUESTS.count(path) for path in set(REQUESTS)}, "Image retry loop"
        assert not launches
        assert STARTUP_CALLBACKS == ["shown"]
        for plugin in home.PLUGIN_IDS:
            count = REQUESTS.count("/plugin-icons/" + plugin + ".png")
            assert count == (0 if MODE == "old-host" else 1)
        resources = window.evaluate_js(
            "performance.getEntriesByType('resource').map(r=>({name:r.name,status:r.responseStatus}))")
        assert not any(r["name"].startswith("https:") for r in resources)
        modules = {name: str(Path(module.__file__).resolve())
                   for name, module in tuple(sys.modules.items())
                   if (name == "application" or name.startswith("application."))
                   and getattr(module, "__file__", None)}
        assert all(Path(path).is_relative_to(ROOT / "python") for path in modules.values())
        assert original_launch_service is launching.launch_plugin
        REPORT.update(status="passed", rows=images, info=api_info[0], requests=counts,
                      resources=resources, applicationModules=modules,
                      launchServiceModule=launching.__file__, pluginLaunches=launches,
                      startupCallbacks=STARTUP_CALLBACKS,
                      realWebView2=True, realAllplanContext=False)
    except Exception:
        REPORT.update(status="failed", traceback=traceback.format_exc(), requests=REQUESTS)
    finally:
        (ROOT / ("webview2-delivery-" + MODE + ".json")).write_text(
            json.dumps(REPORT, indent=2), encoding="utf-8")
        window.destroy()


def start(**kwargs):
    return original_start(inspect, **kwargs)


with patch.object(bottle, "Bottle", side_effect=site_factory), \
        patch.object(home.HomeApi, "get_home_info", get_info), \
        patch.object(webview, "start", start), \
        patch("application.launcher.selector.launch_plugin", side_effect=refuse_launch) as launch:
    # The real launch function remains available to assert its provenance.
    home.show_home(LaunchContext(origin="allplan", allplan_version="2026"),
                   home.HOME_DIRECTORY, home.HOME_REVISION,
                   on_started=lambda: STARTUP_CALLBACKS.append("shown"))
    if launch.called:
        raise AssertionError("Unexpected launch call")
if REPORT.get("status") != "passed":
    raise RuntimeError(REPORT)
print("PASS real WebView2 delivered home:", MODE, "; no plugin launched")
