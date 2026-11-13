"""Explicit opt-in wiring, only after verification of the coordinated publication."""
from concurrent.futures import ThreadPoolExecutor
import logging

from application.core.bridge import push
from application.core.context import LaunchContext
from .close_coordinator import VobCloseCoordinator
from .coordinated_references import load_coordinated_references


def prepare_coordinated_host(app, window, *, identified, schedule_close) -> VobCloseCoordinator:
    logger = logging.getLogger(__name__)
    workers = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vob-close-events")
    coordinator = VobCloseCoordinator(
        identified=identified,
        emit=lambda event, payload: push(window, event, payload),
        defer=workers.submit, schedule_close=schedule_close,
        destroy=window.destroy, logger=logger,
        release=lambda: workers.shutdown(wait=False, cancel_futures=True),
    )

    def references(payload):
        provider = app._allplan_datas
        if provider is None:
            context = LaunchContext()
        else:
            raw = provider.get_context()
            context = LaunchContext(
                allplan_version=raw["version"], country=raw.get("country") or None,
                verification_version=raw.get("verification_version", False),
                allplan_language=raw.get("language"),
                paths={key: path for key, path in raw["paths"].items() if path is not None},
            )
        result = load_coordinated_references(context, payload["lang"])
        for category, metadata in result["metadata"].items():
            logger.info("VOB references: category=%s status=%s sources=%r diagnostics=%d",
                        category, metadata["status"], metadata["sources"],
                        len(metadata["diagnostics"]))
        return result

    window.events.closing += coordinator.native_closing
    window.events.closed += coordinator.closed
    def cancel_close(payload):
        result = coordinator.cancel(payload)
        if result["status"] == "cancelled":
            app._pending_etc_write = None
        return result

    app._handlers.update({
        "reference.load": references,
        "vob.close.ready": coordinator.ready,
        "vob.close.request": coordinator.request,
        "vob.close.cancel": cancel_close,
        "vob.close.authorize": coordinator.authorize,
    })
    return coordinator
