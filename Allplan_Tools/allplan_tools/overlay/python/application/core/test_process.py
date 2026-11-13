"""Windows process policy for this explicitly identified test work copy."""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4


def console_options():
    if sys.platform != "win32":
        return {}
    visible = os.environ.get("ALLPLAN_TOOLS_DIAGNOSTIC_CONSOLE") == "1"
    return {"creationflags": subprocess.CREATE_NEW_CONSOLE if visible else subprocess.CREATE_NO_WINDOW}


def process_log_directory():
    return Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher" / "logs"


def spawn_logged(command, *, spawn=subprocess.Popen, **kwargs):
    directory = process_log_directory()
    directory.mkdir(parents=True, exist_ok=True)
    log = directory / ("process-" + uuid4().hex + ".log")
    with log.open("ab", buffering=0) as output:
        return spawn(command, stdout=output, stderr=subprocess.STDOUT,
                     **console_options(), **kwargs)
