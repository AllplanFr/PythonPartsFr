"""Explicit pinned local AIM delivery; never falls back to remote resources."""
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree

from application.core.resources import PACKAGE_ROOT
from .aim_remote_review import COMMANDS, ORIGIN, ROUTE, run_protected


REVISION = "0c62e46d5699c24c553e4ce6a667315f524180a5"
TREE = "b8a8cb115000550a1e51170ce0586a7f72ce1aa8"
ARTIFACT_SHA256 = "f483f5c629fe2476366ff4beaf3ac2da63ff6417d90b2052e19dbc09a26af233"
PYTHON_STATE = "aim-resolution-1cfc1bf49c6a"
PYTHON_FILES = {
    r"plugins\information_manager\project.py":
        "0e9dc3a101f98c77dc3a2958d2020af3165db4af3f63527a789c0a6d31dd0911",
    r"plugins\information_manager\presentation_import.py":
        "e4c72ddffc2be2e7c2282eb475cee7ab5a85a03a8a8862083039cb1c66e7a553",
}
WORKING_REVISION = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
WORKING_TREE = "a5f51ec092b2dabf2796ea67628d05d859ce5d08"
WORKING_ARTIFACT_SHA256 = "6452e7d92e24f03d8c1ab738eaeeeb1380cca35c384a4293329348f0add97b52"
WORKING_PYTHON_STATE = "aim-working-state-0b05206"
WORKING_PYTHON_FILES = {
    r"core\allplan\readers\attributes.py":
        "dcdbb023bf0d02fe96ec8f2a99a06b1a42049c6924dc6f09d6c58bd9c3ad3bbd",
    r"core\logging_setup.py":
        "0966359ec6b97f655c4939f2211f58bc03de229a12da938d674dfebc7534856b",
    r"core\windows_ui.py":
        "3c489c9284806b37729f504b2ea6cd9faebf30040e8f4374b6a602c160180320",
    r"launcher\aim_remote_review.py":
        "cc8acd851ff57119a3f949652212e0e32f46cb4e9b4e0532d064b546cdd1ba48",
    r"plugins\information_manager\legacy_presentation.py":
        "5ea56a16e1499ec9307e76b7cddc38e3d83752cf2ca6aff92ca9baeca4e6d10d",
    r"plugins\information_manager\presentation.py":
        "16299b8060879c2efda324eeea955ae59021f2c660979ee408b139b357c22b93",
    r"plugins\information_manager\presentation_import.py":
        "3e561fa129d9a2a08f9551a4a6637aa5a95750f0dcb24543af692c8654c615a6",
    r"plugins\information_manager\presentation_structure.py":
        "4040f9f835a1bf0f49ad12adcf5870e94f7da51cd5f0de1bfb9840d4f3a65ce6",
    r"plugins\information_manager\project.py":
        "43331daa3ba2c0c3d534980a685f4771df2d2a0ca8300f7b85ccd50ac912c675",
    r"plugins\information_manager\project_manager.py":
        "df3bb08bcb7d273865b937f0e0820567f5d0061805e7c53dbafc95e5078acd95",
    r"plugins\information_manager\working.py":
        "f3015a3f75a8b6e13a27a983f27424dc3076d997818ac6ef44a3608ea2106ee0",
}
LIMIT = 32 * 1024 * 1024
LOCAL_IMAGES = {
    "favicon.png",
    "assets/folder_prj-B99bYo91.png",
    *(f"aim-assets/checkbox/{name}.png" for name in (
        "checkbox_3", "checkbox_disabled", "checkbox_off", "checkbox_off_hover",
        "checkbox_on", "checkbox_on_hover",
    )),
}


def resource_mime(path, body):
    if path.endswith(".js"):
        return "text/javascript"
    if path.endswith(".css"):
        return "text/css"
    if path.endswith(".png"):
        if not body.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Image PNG AIM invalide.")
        return "image/png"
    if path.endswith(".svg"):
        if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
            raise ValueError("Declarations SVG AIM interdites.")
        try:
            root = ElementTree.fromstring(body)
        except ElementTree.ParseError as exc:
            raise ValueError("Image SVG AIM invalide.") from exc
        namespace = "{http://www.w3.org/2000/svg}"
        allowed = {"svg", "defs", "style", "symbol", "use", "g", "path", "rect",
                   "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"}
        if root.tag != namespace + "svg":
            raise ValueError("Racine SVG AIM invalide.")
        for element in root.iter():
            if element.tag not in {namespace + name for name in allowed}:
                raise ValueError("Element actif ou externe SVG AIM interdit.")
            if element.tag == namespace + "style":
                style = "".join(element.itertext())
                if "\\" in style or "@" in style or re.search(r"url\s*\(|expression\s*\(", style, re.I):
                    raise ValueError("Style SVG AIM externe ou actif interdit.")
            for name, value in element.attrib.items():
                local_name = name.rsplit("}", 1)[-1].lower()
                if (local_name.startswith("on") or local_name == "base"
                        or local_name == "href" and not re.fullmatch(r"#[A-Za-z0-9_.-]+", value)
                        or "\\" in value or re.search(r"url\s*\(|expression\s*\(", value, re.I)):
                    raise ValueError("Reference SVG AIM externe ou active interdite.")
        return "image/svg+xml"
    raise ValueError("Type de ressource AIM locale non autorise.")


def installation_file():
    return (Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher" /
            "information_manager" / "local-delivery.json")


def delivery_pin(revision):
    if revision == REVISION:
        return {
            "tree": TREE, "sha256": ARTIFACT_SHA256, "python_state": PYTHON_STATE,
            "python_files": PYTHON_FILES,
        }
    if revision == WORKING_REVISION:
        return {
            "tree": WORKING_TREE, "sha256": WORKING_ARTIFACT_SHA256,
            "python_state": WORKING_PYTHON_STATE, "python_files": WORKING_PYTHON_FILES,
        }
    return None


def verify_python(revision=REVISION):
    pin = delivery_pin(revision)
    if pin is None:
        raise ValueError("Revision Python AIM non autorisee.")
    for name, digest in pin["python_files"].items():
        if hashlib.sha256((PACKAGE_ROOT / name).read_bytes()).hexdigest() != digest:
            raise ValueError("Etat Python AIM different de la livraison locale installee.")


def local_resources(archive, expected_sha256=ARTIFACT_SHA256, revision=REVISION):
    pin = delivery_pin(revision)
    if pin is None or expected_sha256 != pin["sha256"]:
        raise ValueError("Identite de livraison locale AIM non autorisee.")
    archive = Path(archive)
    if archive.stat().st_size > LIMIT:
        raise ValueError("Archive AIM locale trop volumineuse.")
    data = archive.read_bytes()
    if len(data) > LIMIT or hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError("Empreinte de l'archive AIM locale differente.")
    with zipfile.ZipFile(BytesIO(data)) as package:
        entries = package.infolist()
        names = [entry.filename for entry in entries]
        if (len(entries) > 100 or len({name.casefold() for name in names}) != len(names)
                or sum(entry.file_size for entry in entries) > LIMIT
                or any(entry.is_dir() or entry.flag_bits & 1 for entry in entries)):
            raise ValueError("Entrees de l'archive AIM locale non autorisees.")
        if any(not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", name)
               or any(part in (".", "..") for part in name.split("/")) for name in names):
            raise ValueError("Chemin interne d'archive AIM non autorise.")
        manifest = json.loads(package.read("artifact-manifest.json"))
        if (manifest["schema"] != "aim-local-recipe/1"
                or manifest["revision"] != revision or manifest["tree"] != pin["tree"]):
            raise ValueError("Arbre source de l'archive AIM locale different.")
        inventory = manifest["files"]
        if (len({item["file"] for item in inventory}) != len(inventory)
                or set(names) != {"artifact-manifest.json", *(item["file"] for item in inventory)}):
            raise ValueError("Inventaire de l'archive AIM locale different.")
        contents = {}
        for item in inventory:
            body = package.read(item["file"])
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("Ressource AIM locale modifiee.")
            contents[item["file"]] = body
    build = json.loads(contents["build-manifest.json"])
    if (build["schema"] != "build-identity/1" or build["revision"] != revision
            or build["trackedChangesAtBuild"] is not False):
        raise ValueError("Construction AIM locale non identifiee.")
    resources = {ROUTE: ("text/html; charset=utf-8", contents["document.html"])}
    for item in build["files"]:
        path = item["file"]
        if not re.fullmatch(r"/assets/[A-Za-z0-9_.-]+\.(?:js|css|png|svg)", path):
            raise ValueError("URL de ressource AIM locale non autorisee.")
        url = ORIGIN + path
        if url in resources:
            raise ValueError("Ressource AIM locale dupliquee.")
        body = contents[path.lstrip("/")]
        if hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError("Empreinte de ressource AIM locale differente.")
        mime = resource_mime(path, body)
        resources[url] = (mime, body)
    images = manifest.get("localImages", [])
    if (not isinstance(images, list) or any(not isinstance(name, str) for name in images)
            or len(set(images)) != len(images) or not set(images) <= LOCAL_IMAGES):
        raise ValueError("Inventaire d'images locales AIM non autorise.")
    if any(name not in contents for name in images):
        raise ValueError("Image locale AIM absente de l'inventaire protege.")
    for name in images:
        url = ORIGIN + "/" + name
        if url in resources:
            raise ValueError("Ressource AIM locale dupliquee.")
        body = contents[name]
        resources[url] = (resource_mime(name, body), body)
    aim = b"\n".join(body for url, (_, body) in resources.items()
                     if "/assets/information-manager-" in url)
    if not all(marker.encode() in aim for marker in (
            "presentation_contract", "presentation_capabilities", "aim-organized-presentation",
            *COMMANDS)):
        raise ValueError("Consommateur de presentation AIM absent.")
    return build, resources


def installed_resources():
    descriptor = installation_file()
    if not descriptor.is_file():
        raise RuntimeError(
            "AIM : lancement distant bloque ; aucune livraison locale protegee installee."
        )
    if descriptor.stat().st_size > 8192:
        raise ValueError("Descripteur de livraison AIM invalide.")
    info = json.loads(descriptor.read_text(encoding="utf-8"))
    pin = delivery_pin(info.get("revision"))
    if (set(info) != {"schema", "revision", "tree", "sha256", "pythonState", "artifact"}
            or info["schema"] != "aim-local-installation/1"
            or pin is None or info["tree"] != pin["tree"]
            or info["sha256"] != pin["sha256"]
            or info["pythonState"] != pin["python_state"]):
        raise ValueError("Livraison locale AIM incompatible ; aucun repli distant.")
    from application.core.context import LaunchContext
    archive = LaunchContext._path(info["artifact"])
    verify_python(info["revision"])
    try:
        return local_resources(
            archive, expected_sha256=info["sha256"], revision=info["revision"],
        )
    except zipfile.BadZipFile as exc:
        raise ValueError("Archive AIM locale invalide ; aucun repli distant.") from exc


def run_installed(app, workspace):
    if app.app_id != "information_manager" or not app._requires_protected_host:
        raise ValueError("Le mode local protege est reserve au service AIM.")
    manifest, resources = installed_resources()
    run_protected(app, workspace, manifest, resources)
