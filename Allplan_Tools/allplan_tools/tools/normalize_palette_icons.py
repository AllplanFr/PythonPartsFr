"""Normalize palette-only alpha bounds, retaining all nontransparent artwork."""
import json
from pathlib import Path
import shutil
import sys

import clr
clr.AddReference("System.Drawing")
from System.Drawing import Bitmap, Color, Font, Graphics, Rectangle
from System.Drawing.Drawing2D import CompositingMode, InterpolationMode
from System.Drawing.Imaging import ImageFormat, PixelFormat

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from application.core.plugin_icons import DEFAULT_ICON
from application.core.catalog import PLUGINS


def bounds(image, threshold=0):
    points = [(x, y) for y in range(image.Height) for x in range(image.Width)
              if image.GetPixel(x, y).A > threshold]
    if not points:
        raise ValueError("Empty artwork")
    return [min(x for x, y in points), min(y for x, y in points),
            max(x for x, y in points) + 1, max(y for x, y in points) + 1]


def normalize(source, destination, size):
    image = Bitmap(str(source))
    canvas = Bitmap(size, size, PixelFormat.Format32bppArgb)
    graphics = Graphics.FromImage(canvas)
    try:
        left, top, right, bottom = bounds(image)
        occupied = Rectangle(left, top, right-left, bottom-top)
        # 87.5% common occupancy: 112/128 or 21/24; transparent margins only.
        maximum = round(size * 0.875)
        scale = min(maximum / occupied.Width, maximum / occupied.Height)
        width, height = round(occupied.Width * scale), round(occupied.Height * scale)
        target = Rectangle((size-width)//2, (size-height)//2, width, height)
        graphics.Clear(Color.Transparent)
        graphics.CompositingMode = CompositingMode.SourceCopy
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic
        from System.Drawing import GraphicsUnit
        graphics.DrawImage(image, target, occupied, GraphicsUnit.Pixel)
        canvas.Save(str(destination), ImageFormat.Png)
        return {"sourceDimensions": [image.Width, image.Height],
                "sourceAlphaBox": [left, top, right, bottom],
                "outputDimensions": [size, size], "targetBox": [
                    target.X, target.Y, target.Right, target.Bottom],
                "outputAlphaBox": bounds(canvas),
                "outputVisibleBox": bounds(canvas, 16)}
    finally:
        graphics.Dispose()
        canvas.Dispose()
        image.Dispose()


def main():
    import ast
    import xml.etree.ElementTree as ET
    report = {}
    for palette in (ROOT / "library").glob("*.pyp"):
        wrapper = ROOT / "pythonparts" / Path(ET.parse(palette).findtext("./Script/Name"))
        tree = ast.parse(wrapper.read_text())
        target = next(n.args[0].value for n in ast.walk(tree)
                      if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "control_event")
        source = (PLUGINS[target].package_dir / PLUGINS[target].icon
                  if target in PLUGINS else DEFAULT_ICON)
        report[palette.stem] = {str(size): normalize(
            source, palette.with_name(palette.stem + "_" + str(size) + ".png"), size)
            for size in (24, 128)}
        shutil.copyfile(palette.with_name(palette.stem + "_128.png"), palette.with_suffix(".png"))
    for size in (24, 128):
        normalize(DEFAULT_ICON, ROOT / "template" / ("Plugin_" + str(size) + ".png"), size)
    shutil.copyfile(ROOT / "template" / "Plugin_128.png", ROOT / "template" / "Plugin.png")
    (ROOT / "palette-normalization.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
