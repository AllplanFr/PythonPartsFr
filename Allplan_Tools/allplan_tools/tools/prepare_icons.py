"""Derive local icons with installed WebView2/System.Drawing; no extra packages."""
import base64
from io import BytesIO
import json
from pathlib import Path
import shutil
import struct
import sys
from threading import Timer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from application.core.catalog import PLUGINS
from application.core.plugin_icons import DEFAULT_ICON
import clr
clr.AddReference("System.Drawing")
from System.Drawing import Bitmap, Color, Graphics, Rectangle
from System.Drawing.Imaging import ImageFormat, PixelFormat
from System.Drawing.Drawing2D import CompositingMode, InterpolationMode


def render_svg(path):
    import webview
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    result = {}
    window = webview.create_window("Icon preparation", html="<html><body></body></html>",
                                   hidden=True)
    def render():
        try:
            window.evaluate_js("""
                window.iconResult = null;
                const image = new Image();
                image.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = c.height = 128;
                    c.getContext('2d').drawImage(image, 0, 0, 128, 128);
                    window.iconResult = c.toDataURL('image/png').split(',')[1];
                };
                image.onerror = () => { window.iconResult = 'ERROR'; };
                image.src = 'data:image/svg+xml;base64,%s';
            """ % data)
            import time
            for _ in range(100):
                value = window.evaluate_js("window.iconResult")
                if value:
                    if value == "ERROR":
                        raise ValueError("SVG rasterization failed")
                    result["png"] = base64.b64decode(value)
                    return
                time.sleep(0.1)
            raise TimeoutError("SVG rasterization timed out")
        except Exception as exc:
            result["error"] = exc
        finally:
            window.destroy()
    timer = Timer(30, window.destroy)
    timer.start()
    try:
        webview.start(render, gui="edgechromium", debug=False)
    finally:
        timer.cancel()
    if "png" not in result:
        raise RuntimeError("No SVG output") from result.get("error")
    destination = path.with_suffix(".raster.png")
    destination.write_bytes(result["png"])
    return destination


def resized(source, destination, size):
    image = Bitmap(str(source))
    canvas = Bitmap(size, size, PixelFormat.Format32bppArgb)
    graphics = Graphics.FromImage(canvas)
    try:
        graphics.Clear(Color.Transparent)
        graphics.CompositingMode = CompositingMode.SourceCopy
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic
        scale = min(size / image.Width, size / image.Height)
        width, height = round(image.Width * scale), round(image.Height * scale)
        graphics.DrawImage(image, Rectangle((size-width)//2, (size-height)//2, width, height))
        canvas.Save(str(destination), ImageFormat.Png)
    finally:
        graphics.Dispose()
        canvas.Dispose()
        image.Dispose()


def ico(png, destination):
    frames = []
    for size in (16, 24, 32, 48, 64, 128, 256):
        image = destination.with_name(destination.stem + "-" + str(size) + ".png")
        resized(png, image, size)
        frames.append((size, image.read_bytes()))
        image.unlink()
    offset = 6 + 16 * len(frames)
    entries, data = [], []
    for size, frame in frames:
        entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32,
                                   len(frame), offset))
        data.append(frame)
        offset += len(frame)
    destination.write_bytes(struct.pack("<HHH", 0, 1, len(frames)) + b"".join(entries + data))


def main():
    sources = {}
    for plugin in PLUGINS.values():
        target = plugin.package_dir / plugin.icon
        if "--from-sources" in sys.argv or not target.is_file():
            source = next(path for path in (plugin.package_dir / "resources").glob("identity-source.*")
                          if path.name in ("identity-source.jpg", "identity-source.svg",
                                           "identity-source.png"))
            if source.suffix == ".svg":
                source = render_svg(source)
            resized(source, target, 128)
        ico(target, target.with_suffix(".ico"))
        sources[plugin.id] = target
    if "--from-sources" in sys.argv or not DEFAULT_ICON.is_file():
        resized(DEFAULT_ICON.with_name("default-icon-source.png"), DEFAULT_ICON, 128)
    ico(DEFAULT_ICON, DEFAULT_ICON.with_suffix(".ico"))
    from normalize_palette_icons import main as normalize_palettes
    normalize_palettes()
    print("Prepared four palette identities, three plugin PNG/ICO pairs, default and template")


if __name__ == "__main__":
    main()
