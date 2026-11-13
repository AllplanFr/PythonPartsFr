"""Real WinForms icons with local blank pages, not an Allplan acceptance test."""
import hashlib
import json
from pathlib import Path
import sys
import traceback
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
import webview
from application.core.catalog import PLUGINS
from application.core.plugin_icons import bind_window_icon, icon_candidates

report = {}
windows = []
missing = SimpleNamespace(id="missing-icon-fallback", package_dir=ROOT / "tests", icon="absent.png")
for plugin in (None, *PLUGINS.values(), missing):
    window = webview.create_window(plugin.id if plugin else "Allplan Tools",
                                   html="<html><body>Local icon precheck</body></html>", hidden=True)
    bind_window_icon(window, plugin)
    windows.append((window, plugin))


def verify():
    try:
        from System import Action
        from System.Drawing import Icon
        from System.Drawing.Imaging import ImageFormat
        from System.IO import MemoryStream

        def image_hash(icon):
            image = icon.ToBitmap()
            stream = MemoryStream()
            try:
                image.Save(stream, ImageFormat.Png)
                return hashlib.sha256(bytes(stream.ToArray())).hexdigest()
            finally:
                stream.Dispose()
                image.Dispose()

        for window, plugin in windows:
            if not window.events.loaded.wait(25):
                raise TimeoutError("Native probe window did not finish loading: " + window.title)
            expected_path = next(path for path in icon_candidates(plugin, native=True) if path.is_file())
            expected = Icon(str(expected_path))
            try:
                expected_hash = image_hash(expected)
            finally:
                expected.Dispose()
            actual = {}
            def read():
                actual["sha256"] = image_hash(window.native.Icon)
            window.native.Invoke(Action(read))
            assert actual["sha256"] == expected_hash
            report[plugin.id if plugin else "home"] = actual["sha256"]
        report["status"] = "passed"
    except Exception:
        report.update(status="failed", traceback=traceback.format_exc())
    finally:
        (ROOT / "native-icons-result.json").write_text(json.dumps(report, indent=2))
        for window, _plugin in windows:
            window.destroy()


webview.start(verify, gui="edgechromium", debug=False)
if report.get("status") != "passed":
    raise RuntimeError(report)
print("PASS four actual WinForms identities plus missing-icon fallback; no plugin launched")
