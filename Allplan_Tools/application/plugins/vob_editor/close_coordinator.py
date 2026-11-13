"""Correlated close requests; UI callbacks never wait for frontend replies."""
from collections.abc import Callable
import logging
from threading import RLock
from uuid import uuid4


CLOSE_COMMANDS = (
    "vob.close.ready", "vob.close.request", "vob.close.cancel", "vob.close.authorize",
)


class VobCloseCoordinator:
    def __init__(
        self, *, identified: Callable[[], bool],
        emit: Callable[[str, dict], None],
        defer: Callable[[Callable[[], None]], None],
        schedule_close: Callable[[Callable[[], None]], None],
        destroy: Callable[[], None], logger: logging.Logger,
        release: Callable[[], None] = lambda: None,
    ):
        self._identified = identified
        self._emit = emit
        self._defer = defer
        self._schedule_close = schedule_close
        self._destroy = destroy
        self._logger = logger
        self._release = release
        self._lock = RLock()
        self._state = "idle"
        self._request_id = None
        self._reason = None
        self._ready = False
        self._executing = False
        self._cleanup = False

    def _queue_event(self, request_id):
        def emit():
            with self._lock:
                if (self._state != "pending" or self._request_id != request_id
                        or not self._ready or not self._identified()):
                    return
                payload = {"requestId": request_id, "reason": self._reason}
            try:
                self._emit("vob.close_requested", payload)
            except Exception:
                with self._lock:
                    self._ready = False
                self._logger.exception("VOB close event failed: requestId=%s", request_id)
        self._defer(emit)

    def _request(self, reason):
        with self._lock:
            if self._cleanup or not self._identified():
                raise RuntimeError("VOB identity must be verified first.")
            if self._state in ("authorized", "closing"):
                return {"requestId": self._request_id, "status": "closing"}
            status = "reused"
            if self._state == "idle":
                self._request_id = uuid4().hex
                self._reason = reason
                self._state = "pending"
                status = "requested"
            request_id = self._request_id
            ready = self._ready
        if ready:
            self._queue_event(request_id)
        return {"requestId": request_id, "status": status}

    def native_closing(self):
        with self._lock:
            if self._cleanup:
                return True
            if self._executing and self._state == "authorized":
                self._executing = False
                self._state = "closing"
                return True
            if not self._identified() or self._state in ("authorized", "closing"):
                return False
        try:
            self._request("native_window_close")
        except Exception:
            self._logger.exception("VOB native close request failed; window retained")
        return False

    def ready(self, payload):
        if payload:
            raise ValueError("vob.close.ready expects an empty payload.")
        with self._lock:
            self._ready = True
            pending = self._request_id if self._state == "pending" else None
        try:
            if pending is not None:
                self._queue_event(pending)
        except Exception:
            with self._lock:
                self._ready = False
            self._logger.exception("VOB close ready failed; pending request retained")
            raise
        return {"status": "ready"}

    def request(self, payload):
        if payload:
            raise ValueError("vob.close.request expects an empty payload.")
        return self._request("frontend_exit_button")

    @staticmethod
    def _id(payload):
        if (set(payload) != {"requestId"} or not isinstance(payload["requestId"], str)
                or not payload["requestId"].strip()):
            raise ValueError("requestId textuel non vide requis.")
        return payload["requestId"]

    def cancel(self, payload):
        request_id = self._id(payload)
        with self._lock:
            if self._state != "pending" or self._request_id != request_id:
                return self._ignored(request_id)
            self._reset()
        return {"requestId": request_id, "status": "cancelled"}

    @staticmethod
    def _ignored(request_id):
        return {
            "requestId": request_id, "status": "ignored",
            "reason": "not_current_request",
        }

    def _reset(self):
        self._state = "idle"
        self._request_id = None
        self._reason = None
        self._executing = False

    def _close_failed(self, request_id):
        with self._lock:
            if self._request_id == request_id:
                self._reset()
        self._logger.exception("VOB native close failed: requestId=%s; authorization disarmed",
                               request_id)

    def authorize(self, payload):
        request_id = self._id(payload)
        with self._lock:
            if self._state != "pending" or self._request_id != request_id:
                return self._ignored(request_id)
            self._state = "authorized"

        def close():
            with self._lock:
                if (self._cleanup or self._state != "authorized"
                        or self._request_id != request_id):
                    return
                self._executing = True
            try:
                self._destroy()
            except Exception:
                self._close_failed(request_id)
            finally:
                with self._lock:
                    self._executing = False
        try:
            self._schedule_close(close)
        except Exception:
            self._close_failed(request_id)
            raise
        return {"requestId": request_id, "status": "authorized"}

    def abort_startup(self):
        """Internal cleanup is independent of published identity/frontend readiness."""
        with self._lock:
            self._reset()
            self._ready = False
            self._cleanup = True

    def closed(self):
        self.abort_startup()
        self._release()
