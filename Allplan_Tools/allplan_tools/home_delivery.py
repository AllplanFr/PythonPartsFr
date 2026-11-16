"""Verify an explicitly pinned Home ZIP before writing any served resources."""
import hashlib
from pathlib import Path

from application.launcher.vob_local_delivery import (
    LIMIT, _archive_files, _json, _verify_inventories,
)


DELIVERIES = {
    "b8b150c1a1c877fbb5ea6583a8c6d35df2c0c4257e52cf26adb1d1ac60c2ddb3":
        "ccdaa3a932ffe23629decc2fabfeed8ac6e39935",
    "bfb133009787e819d67d1be168f461b886fa05b530ecd5dc848a87d9f4c34292":
        "78977bcdaf02f3066e0c428378b6f62445c61258",
    # Declared export base + local Home-close fix; see separate package provenance.
    "95ee364c33cfa307f40f98d51bc90dd9ad2b4094c5d5782c9545d13bed32d5f7":
        "5c8e62401caecf5d154cd7779cb17c69c2202e8d",
}


def verified_home_package(archive):
    with Path(archive).open("rb") as source:
        data = source.read(LIMIT + 1)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > LIMIT or digest not in DELIVERIES:
        raise ValueError("Home ZIP fingerprint not authorized.")
    files = _archive_files(data)
    manifest = _json(files["home-manifest.json"])
    if (type(manifest) is not dict
            or set(manifest) != {"schema", "revision", "entry", "files"}
            or manifest["schema"] != "allplan-tools-home/1"
            or manifest["revision"] != DELIVERIES[digest]
            or manifest["entry"] != "index.html"
            or type(manifest["files"]) is not dict
            or "index.html" not in manifest["files"]):
        raise ValueError("Home ZIP identity is incompatible.")
    _verify_inventories(
        files, "home-manifest.json", manifest["files"],
        require_sums=digest != "bfb133009787e819d67d1be168f461b886fa05b530ecd5dc848a87d9f4c34292",
    )
    # The checksum sidecar is verified above, but is not a declared web resource.
    return manifest, {name: body for name, body in files.items() if name != "SHA256SUMS.txt"}
