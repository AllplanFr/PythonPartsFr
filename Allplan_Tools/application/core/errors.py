"""Launcher failures retain an actionable message without exposing a traceback."""
import sys


class LaunchError(SystemExit):
    def __init__(self, message: str):
        self.message = message
        super().__init__(2)


def notify_launch_error(message: str) -> None:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "Launcher Allplan", 0x10)
