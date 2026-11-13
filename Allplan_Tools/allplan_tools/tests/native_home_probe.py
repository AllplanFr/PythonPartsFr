"""Targeted native WebView2 precheck, not an Allplan user acceptance test."""
import json
import os
from pathlib import Path
import sys
import time
import traceback


ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "runtime.json").read_text())
os.environ["LOCALAPPDATA"] = CONFIG["profile"]
sys.path.insert(0, str(ROOT / "runtime"))
import home_host as home

home._services()
from application.core.context import LaunchContext
import webview


REPORT = {}
original_start = webview.start


def probe():
    window = webview.windows[0]
    try:
        for _ in range(60):
            time.sleep(0.5)
            if window.evaluate_js("typeof window.pywebview?.api?.get_home_info === 'function'"):
                break
        window.evaluate_js("window.pywebview.api.get_home_info().then(x=>window.__probe=x)")
        for _ in range(40):
            info = window.evaluate_js("window.__probe || null")
            if info:
                break
            time.sleep(0.25)
        time.sleep(1)
        text = window.evaluate_js("document.body.innerText")
        resources = window.evaluate_js(
            "performance.getEntriesByType('resource').map(r=>({name:r.name,status:r.responseStatus}))"
        )
        assert info["home_launch_contract"] == 1
        assert info["context"]["year"] == "2026"
        assert "Applications" in text
        window.evaluate_js("""
            Promise.all(window.__probe.plugins.map(async p => {
                const r = await fetch(p.iconUrl);
                return {id:p.id, url:p.iconUrl, status:r.status, type:r.headers.get('content-type')};
            })).then(x=>window.__iconProbe=x).catch(e=>window.__iconError=String(e));
        """)
        for _ in range(40):
            icons = window.evaluate_js("window.__iconProbe || null")
            if icons:
                break
            time.sleep(0.25)
        assert len(icons) == 3
        assert all(i["status"] == 200 and i["type"].startswith("image/png") for i in icons)
        assert not any(item["name"].startswith("https:") or item.get("status", 0) >= 400 for item in resources)
        REPORT.update(status="passed", url=window.get_current_url(), info=info, resources=resources,
                      iconResponses=icons, frontendConsumesHostIcons=False)
    except Exception:
        REPORT.update(status="failed", traceback=traceback.format_exc())
    finally:
        (ROOT / "native-home-result.json").write_text(json.dumps(REPORT, indent=2), encoding="utf-8")
        window.destroy()


def start(**kwargs):
    return original_start(probe, **kwargs)


webview.start = start
home.show_home(
    LaunchContext(allplan_version="2026", origin="allplan"),
    home.HOME_DIRECTORY, home.HOME_REVISION,
)
if REPORT.get("status") != "passed":
    raise RuntimeError(REPORT)
print("PASS native WebView2 local home and bridge; no plugin launched")
