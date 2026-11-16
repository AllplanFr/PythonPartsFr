"""Configured test child: common services for home and direct PythonParts."""
import argparse
import ctypes
import json
import logging
import os
from pathlib import Path
import sys
import traceback
from uuid import UUID


sys.path.insert(0, str(Path(__file__).resolve().parent))
CONFIG = json.loads((Path(__file__).resolve().parents[1] / "runtime.json").read_text(encoding="utf-8"))
ENTRY_TOKEN = os.environ.pop("ALLPLAN_TOOLS_ENTRY_TOKEN", None)


def report_startup(status):
    """Release the palette guard, not a claim that a plugin window is ready."""
    if ENTRY_TOKEN is None:
        return
    if UUID(ENTRY_TOKEN).hex != ENTRY_TOKEN:
        raise ValueError("Identifiant de demande enfant invalide.")
    logs = Path(CONFIG["profile"]) / "AllplanWebLauncher" / "logs"
    result = logs / ("allplan-entry-" + ENTRY_TOKEN + ".json")
    temporary = result.with_suffix(".tmp")
    try:
        temporary.write_text(json.dumps({"token": ENTRY_TOKEN, "status": status}), encoding="utf-8")
        temporary.replace(result)
    except OSError:
        logging.getLogger(__name__).exception("Echec du retour de demarrage : %s", result)
        ctypes.windll.user32.MessageBoxW(
            None, "Retour de demarrage impossible ; aucune confirmation de fenetre."
            "\nJournal : " + str(result.with_suffix(".log")),
            "Allplan Tools - statut de lancement", 0x30,
        )


def main():
    if Path(os.environ["LOCALAPPDATA"]).resolve() != Path(CONFIG["profile"]).resolve():
        raise ValueError("Profil enfant incorrect.")
    sys.path.insert(0, CONFIG["pythonRoot"])
    from application.core.logging_setup import configure_logging, set_diagnostic
    configure_logging()
    from home_host import HomeApi, HOME_DIRECTORY, HOME_REVISION, _services, show_home
    _services()
    from application.core.context import add_context_arguments, context_from_arguments
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, help="home ou identifiant de plugin installe")
    add_context_arguments(parser)
    args = parser.parse_args()
    context = context_from_arguments(args)
    set_diagnostic(context.diagnostic)
    if args.target == "home":
        show_home(context, HOME_DIRECTORY, HOME_REVISION,
                  on_started=lambda: report_startup("accepted"))
    else:
        api = HomeApi(context)
        reply = api.launch(args.target, context.allplan_version or "",
                           context.verification_version, context.country or "")
        if not reply["ok"]:
            raise RuntimeError(reply["error"])
        logging.getLogger(__name__).info("Processus lance: %s; fenetre non confirmee", args.target)
        report_startup("accepted")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        details = traceback.format_exc()
        logs = Path(CONFIG["profile"]) / "AllplanWebLauncher" / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        log = logs / ("entry-error-" + str(os.getpid()) + ".log")
        log.write_text(details, encoding="utf-8")
        report_startup("failed")
        ctypes.windll.user32.MessageBoxW(
            None, "Lancement refuse : " + str(exc) + "\nJournal : " + str(log),
            "Allplan Tools - test", 0x10,
        )
        raise SystemExit(2)
