"""Dependency-free launch contract, also importable by Allplan's Python."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
import re
from typing import Literal


PATH_NAMES = ("ETC", "PRG", "STD", "PRJ", "USR", "TMP")


def normalize_version(value: object) -> str:
    text = str(value).strip()
    if not re.fullmatch(r"[2-9]\d{3}|99", text):
        raise ValueError("La version Allplan doit etre une annee valide (ou 99).")
    if text != "99" and int(text) < 2022:
        raise ValueError(f"Allplan {text} non pris en charge : 2022+ ou 99 requis.")
    return text


def normalize_country(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z]{3}", value.strip()):
        raise ValueError("Pays : trois lettres requises, sans valeur par defaut.")
    return value.strip().upper()


def installation_key(version: str, verification_version: bool = False) -> str:
    year = normalize_version(version)
    branch = f"{year}_Verification" if verification_version else "Allplan"
    return rf"SOFTWARE\NEMETSCHEK\{branch}\{year}.0"


@dataclass
class LaunchContext:
    allplan_version: str | None = None
    verification_version: bool = False
    country: str | None = None
    paths: dict[str, Path] = field(default_factory=dict)
    catalog_user_path: Path | None = None
    project_path: Path | None = None
    origin: Literal["standalone", "allplan"] = "standalone"
    allplan_language: str | None = None
    diagnostic: bool = False

    def __post_init__(self) -> None:
        if self.allplan_version is not None:
            self.allplan_version = normalize_version(self.allplan_version)
        if type(self.verification_version) is not bool:
            raise ValueError("verification_version doit etre un booleen.")
        if self.verification_version and self.allplan_version is None:
            raise ValueError("--verification-version necessite --allplan-version.")
        if self.country is not None:
            self.country = normalize_country(self.country)
        if self.allplan_language is not None:
            if not isinstance(self.allplan_language, str) or not re.fullmatch(
                r"[A-Za-z]{2,3}", self.allplan_language.strip()
            ):
                raise ValueError("Langue Allplan : code de deux ou trois lettres requis.")
            self.allplan_language = self.allplan_language.strip().lower()
        if type(self.diagnostic) is not bool:
            raise ValueError("diagnostic doit etre un booleen.")
        if self.origin not in ("standalone", "allplan"):
            raise ValueError("Origine de lancement invalide.")
        if set(self.paths) - set(PATH_NAMES):
            raise ValueError("Cles de chemins invalides.")
        self.paths = {name: self._path(raw) for name, raw in self.paths.items()}
        if self.catalog_user_path is not None:
            self.catalog_user_path = self._path(self.catalog_user_path)
        if self.project_path is not None:
            self.project_path = self._path(self.project_path)

    @staticmethod
    def _path(raw: object) -> Path:
        if not isinstance(raw, (str, Path)) or "\x00" in str(raw):
            raise ValueError("Chemin textuel absolu requis.")
        path = Path(raw)
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("Chemin absolu sans .. requis.")
        return path

    def to_allplan_paths(self):
        from .allplan.paths import AllplanPaths
        if self.allplan_version is None:
            raise ValueError("Version Allplan requise pour resoudre ses ressources.")
        return AllplanPaths(
            self.allplan_version, self.country or "", self.verification_version,
            paths={name: self.paths.get(name) for name in PATH_NAMES},
            language=self.allplan_language,
        )


def add_context_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--allplan-version")
    parser.add_argument("--verification-version", action="store_true")
    parser.add_argument("--country")
    parser.add_argument("--allplan-language")
    parser.add_argument("--diagnostic", action="store_true")
    parser.add_argument("--origin", choices=("standalone", "allplan"), default="standalone")
    parser.add_argument("--catalog-user-path", type=Path)
    parser.add_argument("--project-path", type=Path)
    for name in PATH_NAMES:
        parser.add_argument(f"--{name.lower()}-path", type=Path)


def context_from_arguments(args: argparse.Namespace) -> LaunchContext:
    return LaunchContext(
        allplan_version=args.allplan_version,
        verification_version=args.verification_version,
        country=args.country,
        paths={
            name: getattr(args, name.lower() + "_path")
            for name in PATH_NAMES if getattr(args, name.lower() + "_path") is not None
        },
        catalog_user_path=args.catalog_user_path,
        project_path=args.project_path,
        origin=args.origin,
        allplan_language=args.allplan_language,
        diagnostic=args.diagnostic,
    )


def context_to_arguments(context: LaunchContext) -> list[str]:
    # Revalidate mutable data before crossing a process boundary.
    context = LaunchContext(**vars(context))
    result = ["--origin", context.origin]
    if context.diagnostic:
        result.append("--diagnostic")
    if context.allplan_language is not None:
        result.extend(("--allplan-language", context.allplan_language))
    if context.allplan_version is not None:
        result.extend(("--allplan-version", context.allplan_version))
    if context.verification_version:
        result.append("--verification-version")
    if context.country is not None:
        result.extend(("--country", context.country))
    for name in PATH_NAMES:
        if name in context.paths:
            result.extend((f"--{name.lower()}-path", str(context.paths[name])))
    if context.catalog_user_path is not None:
        result.extend(("--catalog-user-path", str(context.catalog_user_path)))
    if context.project_path is not None:
        result.extend(("--project-path", str(context.project_path)))
    return result
