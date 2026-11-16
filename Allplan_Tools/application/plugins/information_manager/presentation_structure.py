"""Traversal of legacy grouped and ordered mixed presentation configurations."""
from copy import deepcopy


def category_children(configuration, category):
    return category["children"] if configuration["version"] == 2 else category["groups"]


def is_group(configuration, child):
    return configuration["version"] == 1 or child["kind"] == "group"


def groups(configuration):
    return [child for category in configuration["categories"]
            for child in category_children(configuration, category)
            if is_group(configuration, child)]


def rows(configuration):
    return [row for category in configuration["categories"]
            for child in category_children(configuration, category)
            for row in (child["rows"] if is_group(configuration, child) else [child])]


def upgrade_configuration(configuration):
    """Lossless v1 -> v2 only; never downgrade mixed ordering."""
    result = deepcopy(configuration)
    if result["version"] == 2:
        return result
    if result["version"] != 1:
        raise ValueError("Version de presentation non prise en charge.")
    result["version"] = 2
    for category in result["categories"]:
        category["children"] = category.pop("groups")
        for group in category["children"]:
            group["kind"] = "group"
            for row in group["rows"]:
                row["kind"] = "row"
    return result
