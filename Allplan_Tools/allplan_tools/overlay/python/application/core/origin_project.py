"""Remember accepted launch origins in the existing AIM manager inventory only."""
from contextlib import contextmanager
import logging
import os
from pathlib import Path
from threading import Lock


LOGGER = logging.getLogger(__name__)
_LOCK = Lock()


@contextmanager
def _inventory_lock(directory):
    import msvcrt
    directory.mkdir(parents=True, exist_ok=True)
    with _LOCK, (directory / "origin-inventory.lock").open("a+b") as lock:
        lock.seek(0, 2)
        if lock.tell() == 0:
            lock.write(b"\0")
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def remember_origin(context):
    """Best effort AFTER process creation; no definition scan or project read."""
    try:
        if context.origin != "allplan" or context.project_path is None:
            return
        project = context.project_path
        if project.suffix.lower() != ".prj" or not project.is_dir():
            return
        from application.plugins.information_manager.project import AimProjectApp
        from application.plugins.information_manager.project_manager import ProjectManager
        root = Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher"
        data = root / "information_manager" / (context.allplan_version or "standalone")
        data /= "verification" if context.verification_version else "standard"
        data /= "data"
        with _inventory_lock(root):
            app = AimProjectApp(data, context)
            manager = ProjectManager(app)
            entries = manager.entries()
            key = app._path_key(project)
            if any(app._path_key(Path(item["path"])) == key for item in entries):
                return
            entries.append({
                "path": str(project),
                "source": {
                    "status": "unresolved", "version": None,
                    "verificationVersion": None, "reason": "definitions_not_loaded",
                },
                "projectInstallation": {"status": "unknown", "reason": "association_unavailable"},
            })
            manager._save(entries)
    except Exception:
        # A successful process launch must never be reported as failed by this side effect.
        LOGGER.exception("Origin project inventory update failed after accepted launch")
