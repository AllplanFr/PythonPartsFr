"""Launch AIM with local resources or an explicitly configured published HTTPS view."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from application.core.aim_instance import AimInstance
from application.core.context import add_context_arguments, context_from_arguments
from application.core.logging_setup import configure_logging, set_diagnostic
from application.plugins.information_manager.presentation import AimPresentationApp
from .aim_local_delivery import resource_mime
from .aim_remote_review import (
    ORIGIN, ROUTE, SAVE_FRONTENDS,
    published_resources, run_protected, trusted_online_url,
)


ROOT = Path(__file__).resolve().parents[2]


def local_resources():
    frontend = ROOT / "frontend"
    output = frontend / ".output"
    manifest = json.loads((output / "aim-native-manifest.json").read_text("utf-8"))
    if manifest["schema"] != "aim-native-build/1" or manifest["revision"] not in SAVE_FRONTENDS:
        raise ValueError("Construction frontend AIM incompatible.")

    def verified(root, name, expected):
        relative = Path(name)
        if (relative.is_absolute() or ".." in relative.parts
                or not relative.parts or ":" in name or "\\" in name):
            raise ValueError("Chemin de ressource AIM invalide.")
        path = root / relative
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Ressource AIM hors construction.")
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != expected:
            raise ValueError("Sources ou ressources AIM modifiees : reconstruire le frontend.")
        return body

    for name, digest in manifest["sources"].items():
        verified(frontend, name, digest)
    document = verified(output, "aim-document.html", manifest["documentSHA256"])
    resources = {ROUTE: ("text/html; charset=utf-8", document)}
    for name, digest in manifest["files"].items():
        body = verified(output / "public", name, digest)
        if name.endswith((".js", ".css", ".png", ".svg")):
            resources[ORIGIN + "/" + name] = (resource_mime(name, body), body)
        elif name == "build-manifest.json":
            resources[ORIGIN + "/" + name] = ("application/json", body)
        elif name.endswith(".jpg"):
            if not body.startswith(b"\xff\xd8"):
                raise ValueError("Image JPEG AIM invalide.")
            resources[ORIGIN + "/" + name] = ("image/jpeg", body)
        elif name not in ("robots.txt", "_headers"):
            raise ValueError("Ressource frontend non prise en charge : " + name)
    return manifest, resources


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true",
                        help="Charger la vue HTTPS publiee configuree dans AIM_ONLINE_URL.")
    add_context_arguments(parser)
    args = parser.parse_args(argv)
    context = context_from_arguments(args)
    configure_logging()
    set_diagnostic(context.diagnostic)
    # Acquire the same lease as the normal launcher, before opening app storage.
    with AimInstance():
        online_url = trusted_online_url(os.environ.get("AIM_ONLINE_URL")) if args.online else None
        if online_url is None:
            manifest, resources = local_resources()
        else:
            manifest, resources = published_resources(None, route=online_url)
        data = Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher" / "information_manager"
        data.mkdir(parents=True, exist_ok=True)
        app = AimPresentationApp(
            data, context, definition_language="fr", working_state=True, project_save=True,
            presentation_save=True,
        )
        run_protected(app, data / "runtime", manifest, resources,
                      online_url=online_url,
                      title="Allplan Information Manager")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
