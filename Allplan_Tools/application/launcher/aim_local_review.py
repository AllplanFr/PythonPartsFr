"""Explicit local-only visual review. Never called by normal AIM launch."""
import argparse
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

from application.core.allplan.project_installation import discover_project_installations, project_installations
from application.core.context import LaunchContext
from application.plugins.information_manager.organized import assemble


def load_inputs(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "tested-source-manifest.json").read_text("utf-8"))
    documents = []
    for name in ("presentation.json", "conversion-report.json"):
        data = (directory / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest["outputs"][name]:
            raise ValueError("Empreinte de conversion invalide.")
        documents.append(json.loads(data))
    return tuple(documents)


def prepare(project, archive, icons, build):
    project, icons, build = Path(project).resolve(), Path(icons).resolve(), Path(build).resolve()
    contexts, _ = discover_project_installations()
    candidates = project_installations(project, LaunchContext(), contexts)
    if len(candidates) != 1 or candidates[0].allplan_version != "2026":
        raise ValueError("Installation 2026 unique requise ; utiliser le chemin PRJ reconnu.")
    configuration, report = load_inputs(archive)
    model = assemble(configuration, report, candidates[0])
    resources = {}
    for category in model["categories"]:
        reference = category["icon"]
        if not reference.startswith("[icones_aim]"):
            raise ValueError("Reference d'icone non portable.")
        name = reference.removeprefix("[icones_aim]")
        if Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Reference d'icone hors perimetre.")
        icon = icons / name
        if icon.is_symlink() or not icon.resolve().is_relative_to(icons):
            raise ValueError("Icone liee refusee.")
        resources[category["iconUrl"]] = ("image/png", icon.read_bytes())
    index = build / "aim-local-review.html"
    if not index.is_file() or index.is_symlink() or not index.resolve().is_relative_to(build):
        raise ValueError("Build client de validation manquant (pas le build Nitro normal).")
    resources["/information-manager"] = ("text/html; charset=utf-8", index.read_bytes())
    for file in sorted((build / "assets").rglob("*")):
        if file.is_file():
            if file.is_symlink() or not file.resolve().is_relative_to(build):
                raise ValueError("Ressource de build liee refusee.")
            resources["/" + file.relative_to(build).as_posix()] = (
                "text/javascript" if file.suffix == ".js" else
                mimetypes.guess_type(file.name)[0] or "application/octet-stream", file.read_bytes(),
            )
    resources["/review-model.json"] = (
        "application/json; charset=utf-8", json.dumps(model, ensure_ascii=False).encode("utf-8"),
    )
    return model, resources


def handler_for(resources, port):
    expected_host = f"127.0.0.1:{port}"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            origin = self.headers.get("Origin")
            if (len(self.headers.get_all("Host", [])) != 1
                    or len(self.headers.get_all("Origin", [])) > 1
                    or self.headers.get("Host") != expected_host
                    or origin not in (None, f"http://{expected_host}")
                    or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none")):
                self.send_error(403)
                return
            target = urlsplit(self.path)
            resource = resources.get(target.path)
            if (resource is None or target.query or target.fragment
                    or target.scheme or target.netloc or "?" in self.path or "#" in self.path):
                self.send_error(404)
                return
            mime, data = resource
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy",
                             "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                             "img-src 'self'; connect-src 'self'; font-src 'self'; "
                             "frame-ancestors 'none'; form-action 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)

    return Handler


@contextmanager
def local_server(resources, port):
    try:
        with HTTPServer(("127.0.0.1", port), handler_for(resources, port)) as server:
            server.timeout = 1
            server.get_request = _timed_request(server.get_request)
            yield server
    finally:
        resources.clear()


def _timed_request(get_request):
    def accept():
        connection, address = get_request()
        connection.settimeout(5)
        return connection, address
    return accept


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--icons", type=Path, required=True)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("Port hors plage 1024..65535.")
    model, resources = prepare(args.project, args.archive, args.icons, args.build)
    print(json.dumps({"counts": model["counts"], "sources": model["sources"]}, ensure_ascii=True))
    if args.check_only:
        resources.clear()
        return
    del model
    with local_server(resources, args.port) as server:
        print(f"Revue locale : http://127.0.0.1:{args.port}/information-manager ; arret Ctrl+C.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
