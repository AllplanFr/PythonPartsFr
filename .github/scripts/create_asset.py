from __future__ import annotations

import argparse
import shutil
from pathlib import Path

TEXT_EXTENSIONS = {
    ".py",
    ".pyp",
    ".xml",
    ".md",
    ".eng",
    ".fra",
    ".txt",
}

PATH_REPLACEMENTS_KEY = "AssetName"
CONTENT_REPLACEMENTS = {
    "AssetName": None,
    "Asset title": None,
    "Titre de l’outil": None,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--asset-name", required=True)
    parser.add_argument("--asset-title-en", required=True)
    parser.add_argument("--asset-title-fr", required=True)
    return parser.parse_args()


def replace_in_path(path_str: str, asset_name: str) -> str:
    return path_str.replace(PATH_REPLACEMENTS_KEY, asset_name)


def replace_in_content(content: str, asset_name: str, asset_title_en: str, asset_title_fr: str) -> str:
    content = content.replace("AssetName", asset_name)
    content = content.replace("Asset title", asset_title_en)
    content = content.replace("Titre de l’outil", asset_title_fr)
    return content


def is_text_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTENSIONS


def copy_template(source: Path, destination: Path, asset_name: str, asset_title_en: str, asset_title_fr: str) -> None:
    for src in sorted(source.rglob("*"), key=lambda p: (len(p.parts), str(p))):
        rel = src.relative_to(source)
        rel_replaced = Path(replace_in_path(str(rel), asset_name))
        dst = destination / rel_replaced

        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue

        dst.parent.mkdir(parents=True, exist_ok=True)

        if is_text_file(src):
            content = src.read_text(encoding="utf-8")
            content = replace_in_content(content, asset_name, asset_title_en, asset_title_fr)
            dst.write_text(content, encoding="utf-8")
        else:
            shutil.copy2(src, dst)


def main() -> None:
    args = parse_args()
    source = Path(args.source).resolve()
    destination = Path(args.destination).resolve()

    if not source.exists():
        raise FileNotFoundError(f"Source not found: {source}")

    copy_template(
        source=source,
        destination=destination,
        asset_name=args.asset_name,
        asset_title_en=args.asset_title_en,
        asset_title_fr=args.asset_title_fr,
    )


if __name__ == "__main__":
    main()
