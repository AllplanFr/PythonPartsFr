# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import datetime
import shutil
import uuid
from pathlib import Path

# Text files remaining in UTF-8 (including all .xml files, regardless of suffix)
TEXT_EXTENSIONS_UTF8 = {
    ".py",
    ".pyp",
    ".xml",
    ".md",
    ".txt"
    }

# Only direct .eng / .fra extensions are expected to be ANSI (Windows-1252 / cp1252)
ANSI_EXTENSIONS = {
    ".eng",
    ".fra"
    }

PATH_PLACEHOLDER_ASSET_NAME = "__ASSET_NAME__"

# Fixed namespace (specific to this repository) used as the base for all generated UUID v5 values
ASSET_UUID_NAMESPACE = uuid.UUID("6f6e7420-6c65-6773-6465-767570706172")


def parse_args() -> argparse.Namespace:
    """ Parse command-line arguments.

    Returns:
        Namespace containing source, destination, asset_name, asset_title_en,
        asset_title_fr, and run_id.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--asset-name", required=True)
    parser.add_argument("--asset-title-en", required=True)
    parser.add_argument("--asset-title-fr", required=True)
    parser.add_argument("--run-id", required=True)
    return parser.parse_args()


def generate_unique_uuid_v5(asset_name: str,
                            run_id:     str) -> str:
    """ Generate a unique UUID v5 by combining the asset name and the unique
    workflow run identifier (github.run_id).

    This guarantees uniqueness even for two assets created with the same
    name at different times, while still producing a deterministic UUID v5
    as recommended by the Allplan PythonParts documentation.

    Args:
        asset_name: technical name of the asset.
        run_id:     unique GitHub Actions workflow run identifier.

    Returns:
        String representation of the generated UUID v5.
    """
    unique_seed = f"{asset_name}-{run_id}"
    return str(uuid.uuid5(ASSET_UUID_NAMESPACE, unique_seed))


def replace_in_path(path_str:   str,
                    asset_name: str) -> str:
    """ Replace the asset name placeholder in a file or directory path.

    Args:
        path_str:   relative path as a string, possibly containing the placeholder.
        asset_name: real asset name to substitute in.

    Returns:
        Path string with the placeholder replaced.
    """
    return path_str.replace(PATH_PLACEHOLDER_ASSET_NAME, asset_name)


def replace_in_content(content:        str,
                       asset_name:     str,
                       asset_title_en: str,
                       asset_title_fr: str,
                       asset_uuid:     str,
                       current_year:   str) -> str:
    """ Replace all known placeholders inside a file's text content.

    Args:
        content:        original file content read from the template.
        asset_name:     real technical asset name.
        asset_title_en: asset title in English.
        asset_title_fr: asset title in French.
        asset_uuid:     generated UUID v5 for this asset.
        current_year:   current year as a string, used for the copyright notice.

    Returns:
        Content with all placeholders substituted.
    """
    content = content.replace("__ASSET_NAME__", asset_name)
    content = content.replace("__ASSET_TITLE_EN__", asset_title_en)
    content = content.replace("__ASSET_TITLE_FR__", asset_title_fr)
    content = content.replace("__ASSET_UUID__", asset_uuid)
    content = content.replace("__CURRENT_YEAR__", current_year)
    return content


def get_encoding(path: Path) -> str | None:
    """ Determine the target encoding for a given file based on its extension.

    Args:
        path: path of the source file.

    Returns:
        "cp1252" for .eng/.fra files, "utf-8" for other known text files,
        or None for binary files that should be copied as-is.
    """
    suffix = path.suffix.lower()

    if suffix in ANSI_EXTENSIONS:
        return "cp1252"

    if suffix in TEXT_EXTENSIONS_UTF8:
        return "utf-8"

    return None  # binary file (e.g. .jpg) -> raw copy


def copy_template(source:         Path,
                  destination:    Path,
                  asset_name:     str,
                  asset_title_en: str,
                  asset_title_fr: str,
                  asset_uuid:     str,
                  current_year:   str) -> None:
    """ Copy the template tree to the destination, renaming paths and
    substituting placeholders in text files.

    Args:
        source:         root directory of the exported template.
        destination:    root directory of the target repository workspace.
        asset_name:     real technical asset name.
        asset_title_en: asset title in English.
        asset_title_fr: asset title in French.
        asset_uuid:     generated UUID v5 for this asset.
        current_year:   current year as a string.
    """
    for src in sorted(source.rglob("*"), key=lambda p: (len(p.parts), str(p))):
        rel = src.relative_to(source)
        rel_replaced = Path(replace_in_path(str(rel), asset_name))
        dst = destination / rel_replaced

        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue

        dst.parent.mkdir(parents=True, exist_ok=True)
        encoding = get_encoding(src)

        if encoding is None:
            shutil.copy2(src, dst)
            continue

        # The source template in the GitHub repository is always UTF-8
        content = src.read_text(encoding="utf-8")
        content = replace_in_content(
            content, asset_name, asset_title_en, asset_title_fr, asset_uuid, current_year
            )

        if encoding == "cp1252":
            dst.write_bytes(content.encode("cp1252", errors="replace"))
        else:
            dst.write_text(content, encoding="utf-8")


def main() -> None:
    """ Entry point: parse arguments, generate asset metadata, and copy the
    template into the destination workspace with all placeholders resolved.
    """
    args = parse_args()
    source = Path(args.source).resolve()
    destination = Path(args.destination).resolve()

    if not source.exists():
        raise FileNotFoundError(f"Source not found: {source}")

    asset_uuid = generate_unique_uuid_v5(args.asset_name, args.run_id)
    current_year = str(datetime.datetime.now().year)

    copy_template(
        source=source,
        destination=destination,
        asset_name=args.asset_name,
        asset_title_en=args.asset_title_en,
        asset_title_fr=args.asset_title_fr,
        asset_uuid=asset_uuid,
        current_year=current_year
        )


if __name__ == "__main__":
    main()
