"""Fixed-project display model for the offline visual review, not project contract 2."""
from copy import deepcopy
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path

from application.core.allplan.models import Availability
from application.core.allplan.project_installation import project_installations
from application.core.allplan.readers.attributes import discover_attributes, read_project_definitions
from application.core.allplan.readers.project_attributes import read_project_attributes
from application.core.allplan.sources import SourceSelection, read_project_config
from application.core.context import LaunchContext
from .legacy_presentation import validate_documents


def _json(value):
    if isinstance(value, (Path, Decimal)):
        return str(value)
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json(item) for item in value]
    return value


def assemble(configuration, report, context: LaunchContext, *, language="fr"):
    """Read using shared services, associate every occurrence in Python; no history writes."""
    validate_documents(configuration, report)
    if (context.allplan_version != "2026" or context.project_path is None
            or len(project_installations(context.project_path, context, ())) != 1
            or any(key not in context.paths for key in ("PRJ", "STD", "ETC"))):
        raise ValueError("Projet reconnu dans le PRJ Allplan 2026 requis.")
    project = context.project_path
    config = read_project_config(project, encoding_hint="cp1252", require_attributes=True)
    if config.state == Availability.UNAVAILABLE:
        raise ValueError("project.cfg/ATTR invalide ; aucune lecture des valeurs.")
    mode = config.data["ATTR"]
    selection = SourceSelection(
        "attributes", "project" if mode == "PRJ" else "std",
        project if mode == "PRJ" else context.paths["STD"],
    )
    files = discover_attributes(context, selection, language, project_only=True)
    definitions = read_project_definitions(files)
    values_result = read_project_attributes(project)
    values = values_result.data.values()
    diagnostics = []
    for issue in (*config.diagnostics, *definitions.diagnostics, *values_result.diagnostics):
        diagnostics.append({
            "code": issue.code, "severity": issue.severity, "message": issue.message,
            "attributeNumber": issue.attribute_number,
            "path": str(issue.provenance.path) if issue.provenance else None,
            "line": issue.provenance.position if issue.provenance else None,
            "lineIds": [],
        })
    categories = deepcopy(configuration["categories"])
    missing_numbers = set()
    counts = dict(configurationLines=0, matchedDefinitions=0, missingDefinitions=0,
                  set=0, unset=0, unavailable=0)
    for category in categories:
        category["iconUrl"] = f"/icons/{category['id']}.png"
        for group in category["groups"]:
            for row in group["rows"]:
                counts["configurationLines"] += 1
                number = str(row.pop("num"))
                row["number"] = number
                definition = definitions.data.get(number)
                row["definition"] = (
                    _json({**asdict(definition), "number": number}) if definition else None
                )
                counts["matchedDefinitions" if definition else "missingDefinitions"] += 1
                state = ("unavailable" if values is None else
                         "set" if number in values else "unset")
                row["valueState"] = state
                row["value"] = values.get(number) if values is not None else None
                counts[state] += 1
                row["diagnostics"] = []
                if definition is None and number not in missing_numbers:
                    missing_numbers.add(number)
                    diagnostics.append({
                        "code": "definition_missing", "severity": "warning",
                        "message": "Definition projet absente pour cette ligne de presentation.",
                        "attributeNumber": number, "path": None, "line": None, "lineIds": [],
                    })
                for issue in diagnostics:
                    diagnostic_number = issue["attributeNumber"]
                    if diagnostic_number is not None and diagnostic_number.isdecimal():
                        diagnostic_number = str(int(diagnostic_number))
                    if diagnostic_number == number or (
                        issue["attributeNumber"] is None and issue["severity"] == "error"
                    ):
                        if row["id"] not in issue["lineIds"]:
                            issue["lineIds"].append(row["id"])
                        if issue["code"] not in row["diagnostics"]:
                            row["diagnostics"].append(issue["code"])
                if "dateFormat" in row:
                    row["diagnostics"].append("date_format_not_supported")
    # Conversion diagnostics are retained separately; source expressions are never sent to the UI.
    conversion_issues = [
        {key: issue[key] for key in ("code", "severity", "targetId", "message")}
        for issue in report["issues"]
    ]
    model = {
        "app": "information_manager", "organized_presentation_contract": 1,
        "read_only": True, "capabilities": [], "validationOnly": True,
        "configurationId": configuration["configurationId"],
        "project": {"name": project.name, "path": str(project)},
        "installation": {
            "version": context.allplan_version,
            "verificationVersion": context.verification_version,
            "allplanLanguage": context.allplan_language,
            "paths": {key: str(context.paths[key]) for key in ("PRJ", "STD", "ETC")},
        },
        "sources": {
            "attr": mode, "language": files.data.language if files.data else None,
            "systemFiles": [str(path) for path in files.data.system] if files.data else [],
            "customFiles": [str(path) for path in files.data.custom] if files.data else [],
            "definitionsStatus": definitions.state.value,
            "valuesStatus": values_result.data.status,
        },
        "categories": categories, "counts": counts, "diagnostics": diagnostics,
        "conversionDiagnostics": conversion_issues,
    }
    validate_model(model)
    return model


def validate_model(model):
    if (model["app"] != "information_manager"
            or model["organized_presentation_contract"] != 1
            or model["read_only"] is not True or model["capabilities"] != []
            or model["validationOnly"] is not True):
        raise ValueError("Identite organisee incompatible.")
    ids = set()
    rows = []

    def register(items):
        for position, item in enumerate(items, 1):
            if item["position"] != position or item["id"] in ids:
                raise ValueError("Position ou identifiant de presentation invalide.")
            ids.add(item["id"])

    register(model["categories"])
    for category in model["categories"]:
        register(category["groups"])
        for group in category["groups"]:
            register(group["rows"])
            for row in group["rows"]:
                rows.append(row)
                state = row["valueState"]
                if (state not in ("set", "unset", "unavailable")
                        or (state == "set" and not isinstance(row["value"], str))
                        or (state != "set" and row["value"] is not None)):
                    raise ValueError("Valeur organisee invalide.")
                if row["definition"] and row["definition"]["number"] != row["number"]:
                    raise ValueError("Numero de definition incoherent.")
    counts = model["counts"]
    expected = {
        "configurationLines": len(rows),
        "matchedDefinitions": sum(row["definition"] is not None for row in rows),
        "missingDefinitions": sum(row["definition"] is None for row in rows),
        **{state: sum(row["valueState"] == state for row in rows)
           for state in ("set", "unset", "unavailable")},
    }
    if counts != expected:
        raise ValueError("Comptages du modele organise incoherents.")
    if any(line_id not in {row["id"] for row in rows}
           for issue in model["diagnostics"] for line_id in issue["lineIds"]):
        raise ValueError("Reference de diagnostic invalide.")
