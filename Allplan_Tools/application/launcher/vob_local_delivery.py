"""Explicit pinned VOB ZIP delivery, with no network fallback or extraction."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import stat
import zipfile

from .aim_local_delivery import resource_mime
from .vob_online import COMPATIBILITY, VOB_FRONTEND_MARKERS, _run_verified


REVISION = "aba4fc0db2ea21ee47fef6100782b38e53ff3a56"
ARTIFACT_SHA256 = "ab91dbd36b8acb4e50a9d0212cf53f6d72a16485b5b692e9b8f49f264a30cb17"
DELIVERIES = {
    ARTIFACT_SHA256: REVISION,
    "4b5f47be334638dc7194096aecca587e8957f34d7c684bb59ef88290ca3bf1ad":
        "ccdaa3a932ffe23629decc2fabfeed8ac6e39935",
    "fc1e0333c6928bdb8fb8e8be3d73d943ac2f743da7a84a2b8d3b50a2a069a87f":
        "a9963364ea9c88fe42bf1e07931cd4f152771998",
}
ORIGIN = "https://vob-editor.localhost"
ROUTE = ORIGIN + "/vob-editor"
DOCUMENT_URLS = (ROUTE, ORIGIN + "/", ORIGIN + "/index.html")
LIMIT = 32 * 1024 * 1024
MAX_FILES = 100


def _path(name):
    if (not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*", name)
            or any(part.endswith(".") or part.split(".")[0].upper() in {
                "CON", "PRN", "AUX", "NUL",
                *(f"COM{i}" for i in range(1, 10)),
                *(f"LPT{i}" for i in range(1, 10)),
            } for part in name.split("/"))):
        raise ValueError("Unsupported local VOB package path.")
    return name


def _json(body):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate local VOB manifest key.")
            result[key] = value
        return result
    return json.loads(body, object_pairs_hook=unique)


def _archive_files(data):
    with zipfile.ZipFile(BytesIO(data)) as package:
        entries = package.infolist()
        if (len(entries) > MAX_FILES
                or sum(item.file_size for item in entries) > LIMIT):
            raise ValueError("Local VOB package exceeds limits.")
        names = {}
        files = {}
        for item in entries:
            name = _path(item.filename[:-1] if item.is_dir() else item.filename)
            mode = item.external_attr >> 16
            if (name.casefold() in names or item.flag_bits & 1
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or item.is_dir() and item.file_size):
                raise ValueError("Unsafe or duplicate local VOB package entry.")
            names[name.casefold()] = item.is_dir()
            if not item.is_dir():
                files[name] = package.read(item)
        for name in names:
            parts = name.split("/")
            if any(names.get("/".join(parts[:i])) is False for i in range(1, len(parts))):
                raise ValueError("Conflicting local VOB package paths.")

    return files


def _verify_inventories(files, manifest_name, inventory, *, require_sums=True):
    expected = {manifest_name, *inventory}
    if require_sums or "SHA256SUMS.txt" in files:
        expected.add("SHA256SUMS.txt")
    if set(files) != expected:
        raise ValueError("Local VOB manifest inventory mismatch.")
    for name, digest in inventory.items():
        _path(name)
        if (not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or hashlib.sha256(files[name]).hexdigest() != digest):
            raise ValueError("Local VOB resource integrity mismatch.")
    if not require_sums and "SHA256SUMS.txt" not in files:
        return
    sums = {}
    for line in files["SHA256SUMS.txt"].decode("utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if match is None:
            raise ValueError("Invalid local VOB SHA256SUMS inventory.")
        digest, name = match.groups()
        _path(name)
        if name in sums:
            raise ValueError("Duplicate local VOB SHA256SUMS entry.")
        sums[name] = digest
    if (set(sums) != set(files) - {"SHA256SUMS.txt"}
            or any(hashlib.sha256(files[name]).hexdigest() != digest
                   for name, digest in sums.items())):
        raise ValueError("Local VOB SHA256SUMS integrity mismatch.")


def _verified_contents(data, *, manifest_name="vob-manifest.json",
                       schema="vob-editor-local/1", app_id="vob_editor",
                       compatibility_key="vobEditorCompatibility",
                       compatibility=COMPATIBILITY, revision=REVISION, route="/vob-editor"):
    files = _archive_files(data)
    manifest = _json(files[manifest_name])
    if (type(manifest) is not dict
            or manifest.get("schema") != schema
            or manifest.get("appId") != app_id
            or manifest.get(compatibility_key) != compatibility
            or manifest.get("revision") != revision
            or manifest.get("revisionStatus") != "git-rev-parse-HEAD"
            or manifest.get("trackedChangesAtBuild") is not False
            or manifest.get("entry") != "index.html"
            or manifest.get("route") != route
            or type(manifest.get("files")) is not dict):
        raise ValueError("Incompatible local VOB manifest.")
    _verify_inventories(files, manifest_name, manifest["files"])
    return manifest, files


def _local_resources(archive, *, expected_sha256, origin, route, manifest_name,
                     markers, manifest_route="/vob-editor", mime_resolver=resource_mime,
                     deliveries=None,
                     **identity):
    archive = Path(archive)
    if archive.stat().st_size > LIMIT:
        raise ValueError("Local VOB archive exceeds limits.")
    with archive.open("rb") as source:
        data = source.read(LIMIT + 1)
    digest = hashlib.sha256(data).hexdigest()
    accepted = {expected_sha256: identity.get("revision", REVISION), **(deliveries or {})}
    if len(data) > LIMIT or digest not in accepted:
        raise ValueError("Local VOB archive fingerprint mismatch.")
    identity["revision"] = accepted[digest]
    manifest, files = _verified_contents(
        data, manifest_name=manifest_name, route=manifest_route, **identity,
    )
    javascript = b"\n".join(body for name, body in files.items() if name.endswith(".js"))
    if not all(marker in javascript for marker in markers):
        raise ValueError("Local VOB frontend contract is missing.")
    resources = {}
    for name, body in files.items():
        if name == "index.html":
            mime = "text/html; charset=utf-8"
        elif name == manifest_name:
            mime = "application/json"
        elif name == "SHA256SUMS.txt":
            mime = "text/plain; charset=utf-8"
        else:
            mime = mime_resolver(name, body)
        resources[origin + "/" + name] = (mime, body)
    resources[route] = resources[origin + "/index.html"]
    resources[origin + "/"] = resources[route]
    return manifest, resources


def local_resources(archive):
    return _local_resources(
        archive, expected_sha256=ARTIFACT_SHA256, origin=ORIGIN, route=ROUTE,
        manifest_name="vob-manifest.json", markers=VOB_FRONTEND_MARKERS,
        deliveries=DELIVERIES,
    )


def run(app, workspace, profile, *, archive):
    manifest, resources = local_resources(archive)
    app.canonical_url = ROUTE
    return _run_verified(
        app, workspace, profile, resources, route=ROUTE,
        coordinated_revision=manifest["revision"],
        document_urls=DOCUMENT_URLS,
    )
