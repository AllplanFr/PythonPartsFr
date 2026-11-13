"""Optional local identities resolved from the existing plugin catalogue."""
import logging
from pathlib import Path
import struct

from .resources import PACKAGE_ROOT, resource_path


LOGGER = logging.getLogger(__name__)
DEFAULT_ICON = PACKAGE_ROOT / "core" / "resources" / "default-icon.png"


def icon_candidates(plugin=None, *, native=False):
    paths = []
    if plugin is not None and plugin.icon:
        paths.append(resource_path(plugin.package_dir, plugin.icon))
    paths.append(DEFAULT_ICON)
    return [path.with_suffix(".ico") if native else path for path in paths]


def optional_icon_names():
    from .catalog import PLUGINS
    paths = {path for plugin in (None, *PLUGINS.values())
             for native in (False, True) for path in icon_candidates(plugin, native=native)}
    return {path.relative_to(PACKAGE_ROOT.parent).as_posix() for path in paths}


def icon_path(plugin=None):
    for path in icon_candidates(plugin):
        try:
            data = path.read_bytes()
            if (len(data) < 33 or not data.startswith(b"\x89PNG\r\n\x1a\n")
                    or data[12:16] != b"IHDR"
                    or not all(0 < n <= 2048 for n in struct.unpack(">II", data[16:24]))):
                raise ValueError("Invalid PNG icon")
            return path
        except (OSError, ValueError):
            LOGGER.warning("Icone locale indisponible : %s ; repli", path, exc_info=True)
    return None


def bind_window_icon(window, plugin=None):
    """before_show runs on the WinForms UI thread in pywebview 6.2.1."""
    def apply():
        from System.Drawing import Icon
        for path in icon_candidates(plugin, native=True):
            try:
                # Clone to release the file handle, allowing later resource replacement.
                source = Icon(str(path))
                try:
                    window.native.Icon = source.Clone()
                finally:
                    source.Dispose()
                LOGGER.info("Icone native appliquee : %s", path)
                return
            except Exception as exc:
                # .NET GDI exceptions are not Python OSError; icon failure is non-fatal.
                LOGGER.warning("Icone native indisponible : %s (%s) ; repli",
                               path, type(exc).__name__)
        LOGGER.warning("Icone native par defaut Windows conservee")

    window.events.before_show += apply
