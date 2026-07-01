""" init"""

from __future__ import annotations

from BuildingElement import BuildingElement

from BaseScriptObject import BaseScriptObject, BaseScriptObjectData

from .main import MyScriptObject


def check_allplan_version(_build_ele: BuildingElement, _version: str) -> bool:
    """Called when the PythonPart is started to check if the current Allplan version is supported.

    Args:
        _build_ele: building element with the parameter properties
        _version: current Allplan version

    Returns:
        True if current Allplan version is supported and PythonPart script can be run, False otherwise
    """
    return float(_version) >= 2026


def create_script_object(build_ele: BuildingElement, script_object_data: BaseScriptObjectData) -> BaseScriptObject:
    """ Creation of the script object

    Args:
        build_ele: building element with the parameter properties
        script_object_data: script object data

    Returns:
        created script object
    """
    return MyScriptObject(build_ele=build_ele, script_object_data=script_object_data)

