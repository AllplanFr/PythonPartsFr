"""Opt-in public catalog transport, bounded by a parent-owned deadline."""
import json
import logging
import math
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
from threading import Lock
from urllib.request import (
    HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener,
)


CATALOG_URL = (
    "https://raw.githubusercontent.com/AllplanFr/PythonPartsFr/main/"
    "Allplan_Tools/plugin-catalog.json"
)
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_WORKER_BYTES = 8 * MAX_RESPONSE_BYTES
MAX_TIMEOUT_SECONDS = 3.0
CLEANUP_TIMEOUT_SECONDS = 0.5
LOGGER = logging.getLogger(__name__)
_WORKER_LOCK = Lock()
_unconfirmed_worker = None


def _read_ready(pipe, limit):
    """Read only bytes already available; never start a blocking pipe reader."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        import msvcrt

        peek = ctypes.WinDLL("kernel32", use_last_error=True).PeekNamedPipe
        peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                         wintypes.LPVOID, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
        peek.restype = wintypes.BOOL
        available = wintypes.DWORD()
        if not peek(msvcrt.get_osfhandle(pipe.fileno()), None, 0, None,
                    ctypes.byref(available), None):
            error = ctypes.get_last_error()
            if error == 109:  # ERROR_BROKEN_PIPE: all writers have closed.
                return b""
            raise ctypes.WinError(error)
        if not available.value:
            return None
        return os.read(pipe.fileno(), min(limit, available.value))
    import select

    if not select.select([pipe], [], [], 0)[0]:
        return None
    return os.read(pipe.fileno(), limit)


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Catalog transport budget expired.")
    return remaining


def _receive(process, deadline):
    output = bytearray()
    while True:
        _remaining(deadline)
        chunk = _read_ready(process.stdout, min(65536, MAX_WORKER_BYTES - len(output) + 1))
        if chunk is not None:
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > MAX_WORKER_BYTES:
                raise ValueError("Catalog worker response is too large.")
        elif process.poll() is not None:
            break
        else:
            time.sleep(min(0.01, _remaining(deadline)))
    try:
        process.wait(timeout=_remaining(deadline))
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("Catalog transport budget expired.") from exc
    _remaining(deadline)
    return output


def _cleanup(process):
    """Bound cleanup separately and retain ownership when termination is unconfirmed."""
    global _unconfirmed_worker
    deadline = time.monotonic() + CLEANUP_TIMEOUT_SECONDS
    failure = None
    try:
        if process.poll() is None:
            try:
                process.kill()
            except OSError as exc:
                if process.poll() is None:
                    LOGGER.error("Catalog worker kill failed; pid=%s", process.pid, exc_info=True)
                    failure = exc
        try:
            process.wait(timeout=max(0, deadline - time.monotonic()))
        except (subprocess.TimeoutExpired, OSError) as exc:
            LOGGER.error("Catalog worker collection failed; pid=%s", process.pid, exc_info=True)
            failure = exc
    except OSError as exc:
        LOGGER.error("Catalog worker state check failed; pid=%s", process.pid, exc_info=True)
        failure = exc
    finally:
        try:
            try:
                stopped = process.poll() is not None
            except OSError as exc:
                stopped = False
                failure = exc
            if not stopped:
                _unconfirmed_worker = process
                LOGGER.error("Catalog worker stop UNCONFIRMED; pid=%s; new workers blocked", process.pid)
                if failure is None:
                    failure = RuntimeError("Worker termination unconfirmed.")
        finally:
            for stream in (process.stdout, process.stderr, process.stdin):
                if stream is not None:
                    try:
                        stream.close()
                    except OSError as exc:
                        LOGGER.error("Catalog worker pipe close failed; pid=%s",
                                     process.pid, exc_info=True)
                        failure = exc
    if failure is not None:
        raise RuntimeError("Catalog worker cleanup failed; consult host log.") from failure


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key.")
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError("Non-finite JSON number.")


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number.")
    return number


def strict_json(data):
    return json.loads(
        data.decode("utf-8"), object_pairs_hook=_unique_object,
        parse_constant=_reject_constant, parse_float=_finite_float,
    )


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise OSError("Catalog redirects are forbidden.")


def _fetch_document(timeout):
    request = Request(CATALOG_URL, headers={
        "User-Agent": "AllplanTools-Catalog/2",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
    })
    # Do not inherit proxy credentials or enable authentication handlers.
    opener = build_opener(
        ProxyHandler({}), _NoRedirect(),
        HTTPSHandler(context=ssl.create_default_context()),
    )
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200 or response.geturl() != CATALOG_URL:
            raise OSError("Unexpected catalog HTTP response.")
        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
            raise ValueError("Encoded catalog responses are unsupported.")
        length = response.headers.get("Content-Length")
        if length is not None:
            if not length.isascii() or not length.isdecimal():
                raise ValueError("Invalid catalog response length.")
            if int(length) > MAX_RESPONSE_BYTES:
                raise ValueError("Catalog response is too large.")
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("Catalog response is too large.")
        if length is not None and len(body) != int(length):
            raise OSError("Incomplete catalog response.")
    return strict_json(body)


class RemoteCatalogLoader:
    """Use a configured Python interpreter, never the embedding host executable."""

    def __init__(self, python_executable):
        if not isinstance(python_executable, str) or not python_executable:
            raise ValueError("Catalogue : pythonExecutable explicite requis.")
        executable = Path(python_executable)
        if not executable.is_absolute() or not executable.is_file():
            raise ValueError("Catalogue : interpreteur Python absolu introuvable.")
        name = executable.name.lower()
        if ((os.name == "nt" and name != "python.exe")
                or (os.name != "nt" and name not in ("python", "python3")
                    and not name.startswith("python3."))):
            raise ValueError("Catalogue : pythonExecutable doit designer un interpreteur Python, pas l'hote.")
        self._executable = executable.resolve()

    def __call__(self, *, timeout):
        global _unconfirmed_worker
        if (type(timeout) not in (int, float) or not math.isfinite(timeout)
                or not 0 < timeout <= MAX_TIMEOUT_SECONDS):
            raise ValueError("Invalid catalog time budget.")
        deadline = time.monotonic() + timeout
        if not _WORKER_LOCK.acquire(timeout=_remaining(deadline)):
            raise TimeoutError("Catalog transport busy; budget expired.")
        try:
            if _unconfirmed_worker is not None:
                try:
                    if _unconfirmed_worker.poll() is None:
                        raise RuntimeError("Previous catalog worker stop unconfirmed; new worker refused.")
                    _unconfirmed_worker.wait(timeout=0)
                except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                    LOGGER.error("Catalog transport refused: previous worker stop/collection unconfirmed; pid=%s",
                                 _unconfirmed_worker.pid, exc_info=True)
                    raise RuntimeError("Previous catalog worker stop unconfirmed; new worker refused.") from exc
                _unconfirmed_worker = None
            _remaining(deadline)
            return self._load(timeout, deadline)
        finally:
            _WORKER_LOCK.release()

    def _load(self, timeout, deadline):
        command = [
            str(self._executable), "-I", "-B", str(Path(__file__).resolve()),
            "--worker", str(timeout),
        ]
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd=str(Path(__file__).resolve().parent),
            shell=False, bufsize=0, **options,
        )
        try:
            output = _receive(process, deadline)
        finally:
            _cleanup(process)
        try:
            _remaining(deadline)
            if process.returncode != 0:
                raise OSError("Catalog transport worker failed.")
            return self._decode(output)
        finally:
            _remaining(deadline)

    def _decode(self, output):
        reply = strict_json(output)
        if (type(reply) is not dict or set(reply) != {"interpreter", "ok", "data", "error"}
                or reply["interpreter"] != str(self._executable)
                or type(reply["ok"]) is not bool):
            raise OSError("Invalid catalog worker identity or response.")
        if reply["ok"]:
            if reply["error"] is not None:
                raise OSError("Invalid catalog worker success.")
            return reply["data"]
        if reply["data"] is not None or reply["error"] not in ("network_error", "invalid_catalog"):
            raise OSError("Invalid catalog worker failure.")
        if reply["error"] == "invalid_catalog":
            raise ValueError("Invalid catalog response.")
        raise OSError("Catalog network request failed.")


def _worker(timeout):
    reply = {"interpreter": str(Path(sys.executable).resolve()),
             "ok": False, "data": None, "error": None}
    try:
        reply["data"] = _fetch_document(timeout)
    except (ValueError, UnicodeError, RecursionError):
        reply["error"] = "invalid_catalog"
    except OSError:
        reply["error"] = "network_error"
    else:
        reply["ok"] = True
    sys.stdout.buffer.write(json.dumps(reply, ensure_ascii=True, allow_nan=False).encode("utf-8"))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--worker":
        raise SystemExit("Internal catalog worker arguments required.")
    budget = float(sys.argv[2])
    if not math.isfinite(budget) or not 0 < budget <= MAX_TIMEOUT_SECONDS:
        raise SystemExit("Invalid catalog worker budget.")
    _worker(budget)
