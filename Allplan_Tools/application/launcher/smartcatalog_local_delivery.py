"""Pinned local SmartCatalog frontend; never falls back to the online site."""
import hashlib
import re
from xml.etree import ElementTree

from .aim_local_delivery import resource_mime

from .vob_local_delivery import _local_resources
from .vob_online import _run_verified


REVISION = "797db6f668543175220f5d8da5b81653b100e1e6"
ARTIFACT_SHA256 = "38c0dbb920d852e9b50ccdae10b3f560e6c931b9d6f177cf242a00b54ea35a1c"
DELIVERIES = {
    ARTIFACT_SHA256: REVISION,
    "6aa1f2d9a39f247f29be85182fb863b7f1b19a6b8eed5a790f471a8f650f1fc1":
        "ccdaa3a932ffe23629decc2fabfeed8ac6e39935",
}
ORIGIN = "https://smartcatalog.localhost"
ROUTE = ORIGIN + "/smartcatalog"
DOCUMENT_URLS = (ROUTE, ORIGIN + "/", ORIGIN + "/index.html")


def _resource_mime(name, body):
    if not name.endswith(".svg"):
        return resource_mime(name, body)
    if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("SVG declarations are forbidden.")
    root = ElementTree.fromstring(body)
    namespace = "{http://www.w3.org/2000/svg}"
    allowed = {"svg", "defs", "style", "symbol", "use", "g", "path", "rect",
               "circle", "ellipse", "line", "polyline", "polygon", "title", "desc",
               "clipPath"}
    if root.tag != namespace + "svg":
        raise ValueError("Invalid SVG root.")
    for element in root.iter():
        if element.tag not in {namespace + tag for tag in allowed}:
            raise ValueError("Active SVG element is forbidden.")
        values = list(element.attrib.items())
        if element.tag == namespace + "style":
            values.append(("style", "".join(element.itertext())))
        for key, value in values:
            attribute = key.rsplit("}", 1)[-1].lower()
            # Only local fragment URLs are needed by the supplied clipping paths.
            safe = re.sub(r"url\(\s*#[A-Za-z0-9_.-]+\s*\)", "", value, flags=re.I)
            if (attribute.startswith("on") or attribute == "base"
                    or attribute == "href" and not re.fullmatch(r"#[A-Za-z0-9_.-]+", value)
                    or "\\" in safe or "@" in safe
                    or re.search(r"url\s*\(|expression\s*\(", safe, re.I)):
                raise ValueError("External or active SVG reference is forbidden.")
    return "image/svg+xml"


def local_resources(archive):
    manifest, resources = _local_resources(
        archive, expected_sha256=ARTIFACT_SHA256, origin=ORIGIN, route=ROUTE,
        manifest_name="smartcatalog-manifest.json",
        markers=(b"smartcatalog", b"get_app_info", b"get_initial_data"),
        schema="smartcatalog-local/1", app_id="smartcatalog",
        compatibility_key="smartcatalogCompatibility",
        compatibility="smartcatalog-host/1", revision=REVISION,
        manifest_route="/smartcatalog",
        mime_resolver=_resource_mime,
        deliveries=DELIVERIES,
    )
    external = manifest.get("externalAssets", {})
    if type(external) is not dict:
        raise ValueError("Invalid SmartCatalog externalAssets inventory.")
    bodies = [body for _, body in resources.values()]
    for item in external.values():
        if (type(item) is not dict or type(item.get("size")) is not int
                or not any(len(body) == item["size"]
                           and hashlib.sha256(body).hexdigest() == item.get("sha256")
                           for body in bodies)):
            raise ValueError("SmartCatalog external asset is not included in the package.")
    return manifest, resources


def run(app, workspace, profile, *, archive):
    _, resources = local_resources(archive)
    app.canonical_url = ROUTE
    return _run_verified(
        app, workspace, profile, resources, route=ROUTE, coordinated_revision=None,
        document_urls=DOCUMENT_URLS, app_id="smartcatalog",
    )
