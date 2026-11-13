"""Opt-in RC1 control service. Never imported by discovery or legacy startup."""
from copy import deepcopy
from importlib.metadata import version
import hashlib
import json
import logging
import math
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .context import LaunchContext
from . import logging_setup


LOGGER = logging.getLogger(__name__)
HOST_OBJECT = "__allplanProtocolHost"
CLIENT_OBJECT = "__allplanProtocolClient"
READY_EVENT = "allplan-protocol-host-ready"
RELEASE = "2.0.0-rc.1"
_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
_MAX_REQUESTS = 128


class ProtocolBoundaryError(ValueError):
    """A message cannot safely be represented as a correlated RC1 response."""


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProtocolBoundaryError("Duplicate JSON key.")
            result[key] = value
        return result

    def constant(_value):
        raise ProtocolBoundaryError("Non-finite JSON constant.")

    def number(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ProtocolBoundaryError("Non-finite JSON number.")
        return parsed

    try:
        return json.loads(
            text, object_pairs_hook=pairs, parse_constant=constant, parse_float=number,
        )
    except (ValueError, RecursionError) as exc:
        raise ProtocolBoundaryError("Invalid strict JSON.") from exc


def artifact_directory():
    packaged = Path(__file__).parent / "resources" / "protocol" / RELEASE
    if packaged.is_dir():
        return packaged
    source = Path(__file__).resolve().parents[2] / "docs" / "integration" / "protocol" / RELEASE
    if source.is_dir():
        return source
    raise RuntimeError("RC1 artifacts missing. Rebuild the control-test package.")


class ControlValidator:
    def __init__(self):
        try:
            from jsonschema import Draft202012Validator, FormatChecker
        except ImportError as exc:
            raise RuntimeError(
                'Mode RC1 : installer explicitement ".[protocol-control-test]".'
            ) from exc
        directory = artifact_directory()
        manifest = strict_json((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest["release"] != RELEASE:
            raise RuntimeError("Unexpected RC1 release.")
        for name in ("schema.json", "fixtures.json"):
            digest = hashlib.sha256((directory / name).read_bytes()).hexdigest()
            if digest != manifest["sha256"][name]:
                raise RuntimeError(f"RC1 integrity failure: {name}")
        self.schema = strict_json((directory / "schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(self.schema)
        self._validators = {}
        for target in ("request", "response", "event", "bootstrap", "context"):
            schema = deepcopy(self.schema)
            schema.pop("oneOf")
            schema["$ref"] = f"#/$defs/{target}"
            self._validators[target] = Draft202012Validator(
                schema, format_checker=FormatChecker(),
            )

    def valid(self, target, value):
        return self._validators[target].is_valid(value)


class ControlSession:
    """Pure control state machine; a native caller must supply a trusted guard."""

    def __init__(self, app_id, context: LaunchContext, *, application_language="fr",
                 authorize=None, emit=None, transport="pywebview_dispatch"):
        self._lock = RLock()
        self._validator = ControlValidator()
        self._active = True
        self._handshake = False
        self._requests: dict[str, tuple[str, dict]] = {}
        self._authorize = authorize
        self._emit = emit
        self._session_id = uuid4().hex
        self._app_id = app_id
        self._transport = transport
        self._context = {
            "context_id": uuid4().hex, "generation": 1,
            "allplan_version": context.allplan_version,
            "verification_version": context.verification_version,
            "country": context.country,
            "allplan_language": context.allplan_language,
            "application_language": application_language,
            "paths": {name: str(path) for name, path in context.paths.items()},
            "project_path": str(context.project_path) if context.project_path else None,
            "catalog_user_path": (
                str(context.catalog_user_path) if context.catalog_user_path else None
            ),
            "origin": context.origin,
        }
        if not self._validator.valid("context", self._context):
            raise ValueError("LaunchContext cannot be represented by RC1.")
        self._handlers = {
            "host.handshake": self._hello,
            "host.capabilities": lambda _payload: {"capabilities": self._capabilities()},
            "host.context": lambda _payload: {"context": deepcopy(self._context)},
            "diagnostic.get": lambda _payload: {"enabled": logging_setup.diagnostic_enabled()},
            "diagnostic.set": self._set_diagnostic,
            "diagnostic.open_logs": self._open_logs,
        }
        if set(self._handlers) != set(self._validator.schema["$defs"]["command"]["enum"]):
            raise RuntimeError("Control dispatcher differs from the RC1 command schema.")
        if not self._validator.valid("bootstrap", self.descriptor()):
            raise ValueError("Invalid RC1 application identity.")

    def descriptor(self):
        return {
            "bootstrap_version": 1, "app_id": self._app_id,
            "session_id": self._session_id, "mode": "protocol",
            "protocol_versions": ["2.0"], "contract_release": RELEASE,
            "transport": self._transport,
        }

    def invalidate(self):
        with self._lock:
            self._active = False
            self._handshake = False
            self._requests.clear()

    def _check_boundary(self):
        if not self._active or self._authorize is None or self._authorize() is not True:
            self.invalidate()
            raise ProtocolBoundaryError("Control session inactive or origin not authorized.")

    def _capabilities(self):
        return [
            {"command": command, "implementation": "implemented",
             "availability": "available", "reason_code": None}
            for command in self._handlers
        ]

    def _hello(self, payload):
        if "2.0" not in payload["supported_versions"]:
            raise ProtocolBoundaryError("No compatible protocol version.")
        return {
            "host_version": version("allplan-web-launcher"),
            "supported_versions": ["2.0"], "negotiated_version": "2.0",
            "contract_release": RELEASE, "session_id": self._session_id,
            "app_id": self._app_id, "capabilities": self._capabilities(),
            "context": deepcopy(self._context),
            "diagnostic": {"enabled": logging_setup.diagnostic_enabled()},
            "limits": {
                "max_message_bytes": _MAX_MESSAGE_BYTES, "max_pending_operations": 0,
                "operation_retention_seconds": 0, "operation_status_supported": False,
                "timeouts": {"control_ms": 15000, "read_ms": 60000,
                             "write_ms": 120000, "dialog_ms": None},
            },
        }

    @staticmethod
    def _set_diagnostic(payload):
        logging_setup.set_diagnostic(payload["enabled"])
        return {"enabled": logging_setup.diagnostic_enabled()}

    @staticmethod
    def _open_logs(_payload):
        logging_setup.open_log_directory()
        return {"opened": True}

    def _response(self, request, *, result=None, code=None):
        response = {
            key: request[key] for key in (
                "protocol_version", "session_id", "request_id", "app_id",
                "command", "context_id", "generation",
            )
        }
        response.update(
            kind="response", status="error" if code else "success",
            operation_id=None, result=result,
            error=({"code": code, "message": "RC1 control request failed.",
                    "retryable": False, "details": {}} if code else None),
        )
        if not self._validator.valid("response", response):
            self.invalidate()
            raise ProtocolBoundaryError("Invalid control response; session invalidated.")
        return response

    def dispatch(self, envelope):
        with self._lock:
            self._check_boundary()
            try:
                text = envelope if isinstance(envelope, str) else json.dumps(
                    envelope, ensure_ascii=False, allow_nan=False,
                )
                if len(text.encode("utf-8")) > _MAX_MESSAGE_BYTES:
                    raise ProtocolBoundaryError("RC1 message too large.")
                request = strict_json(text)
            except (TypeError, ValueError, UnicodeError, RecursionError) as exc:
                LOGGER.warning("RC1 boundary rejected malformed message")
                raise ProtocolBoundaryError("Malformed RC1 message.") from exc
            if not isinstance(request, dict):
                raise ProtocolBoundaryError("RC1 object required.")
            if (request.get("session_id") != self._session_id
                    or request.get("app_id") != self._app_id):
                raise ProtocolBoundaryError("Wrong RC1 session or application.")
            if not self._validator.valid("request", request):
                LOGGER.warning("RC1 boundary rejected message outside request schema")
                raise ProtocolBoundaryError("Message outside RC1 control schema.")
            fingerprint = json.dumps(request, sort_keys=True, ensure_ascii=True)
            request_id = request["request_id"]
            previous = self._requests.get(request_id)
            if previous is not None:
                if previous[0] != fingerprint:
                    raise ProtocolBoundaryError("Request identity reused with different content.")
                return deepcopy(previous[1])
            if len(self._requests) >= _MAX_REQUESTS:
                raise ProtocolBoundaryError("Control request retention full; open a new session.")
            command = request["command"]
            if command != "host.handshake" and not self._handshake:
                # Do not consume the request identity before a successful handshake.
                return self._response(request, code="configuration_error")
            if command == "host.handshake" and "2.0" not in request["payload"]["supported_versions"]:
                response = self._response(request, code="unsupported_protocol")
            else:
                try:
                    result = self._handlers[command](request["payload"])
                    response = self._response(request, result=result)
                except PermissionError:
                    LOGGER.warning("RC1 control access denied")
                    response = self._response(request, code="access_denied")
                except (OSError, KeyError):
                    LOGGER.exception("RC1 control operation unavailable")
                    response = self._response(request, code="io_error")
                except Exception as exc:
                    # A handler may already have changed diagnostic state: never retry it.
                    self.invalidate()
                    LOGGER.exception("RC1 control failed; session invalidated")
                    raise ProtocolBoundaryError("Control failure; session invalidated.") from exc
                if command == "host.handshake" and response["status"] == "success":
                    self._handshake = True
            self._requests[request_id] = (fingerprint, deepcopy(response))
            if command == "diagnostic.set" and response["status"] == "success" and self._emit:
                event = {
                    "protocol_version": "2.0", "kind": "event",
                    "session_id": self._session_id, "app_id": self._app_id,
                    "event_id": uuid4().hex, "event": "diagnostic.state",
                    "context_id": None, "generation": None,
                    "payload": deepcopy(response["result"]),
                }
                if not self._validator.valid("event", event):
                    self.invalidate()
                    raise ProtocolBoundaryError("Invalid diagnostic event.")
                self._check_boundary()
                try:
                    self._emit(event)
                except (OSError, RuntimeError):
                    LOGGER.exception("RC1 event delivery failed; query diagnostic.get")
            return deepcopy(response)


class ControlFacade:
    """The dispatch-only facade, never a legacy app instance."""

    def __init__(self, session):
        self._session = session

    def dispatch(self, envelope):
        return self._session.dispatch(envelope)


def bootstrap_script(descriptor):
    """Serialize data separately from executable JavaScript."""
    validator = ControlValidator()
    if not validator.valid("bootstrap", descriptor):
        raise ValueError("Invalid bootstrap descriptor.")
    data = json.dumps(descriptor, ensure_ascii=True, allow_nan=False)
    return (
        "(() => { const value = " + data + ";"
        f"const name = {json.dumps(HOST_OBJECT)};"
        "if (Object.prototype.hasOwnProperty.call(window, name)) {"
        "throw new Error('RC1 bootstrap collision'); }"
        "Object.freeze(value.protocol_versions); Object.freeze(value);"
        "Object.defineProperty(window, name, {value, writable:false, configurable:false});"
        f"window.dispatchEvent(new CustomEvent({json.dumps(READY_EVENT)}, {{detail:value}}));"
        "})();"
    )


def event_script(event):
    """Candidate native-to-page delivery; only a confined adapter may execute it."""
    if not ControlValidator().valid("event", event):
        raise ValueError("Invalid RC1 event.")
    data = json.dumps(event, ensure_ascii=True, allow_nan=False)
    return (
        "(() => { const message = " + data + ";"
        f"const host = window[{json.dumps(HOST_OBJECT)}];"
        "if (!host || host.session_id !== message.session_id || host.app_id !== message.app_id) {"
        "throw new Error('RC1 event session mismatch'); }"
        f"const client = window[{json.dumps(CLIENT_OBJECT)}];"
        "if (!client || typeof client.receive_message !== 'function') {"
        "throw new Error('RC1 receiver unavailable'); }"
        "client.receive_message(message);"
        "})();"
    )
