# -*- coding: utf-8 -*-
""" Interactor PythonPart

Copyright © 2026 ALLPLAN FRANCE
"""
from __future__ import annotations

from typing import Any, cast

import re
import uuid
import unicodedata
import keyboard
import xml.etree.ElementTree as ET

from pathlib     import Path
from dataclasses import dataclass
from dataclasses import field
from datetime    import date

import NemAll_Python_BaseElements       as BaseElements
import NemAll_Python_BasisElements      as BasisElements
import NemAll_Python_Geometry           as Geometry
import NemAll_Python_AllplanSettings    as Settings
import NemAll_Python_IFW_ElementAdapter as ElementAdapter
import NemAll_Python_Utility            as Utility
import NemAll_Python_IFW_Input          as Input

from BaseInteractor import BaseInteractor
from BaseInteractor import BaseInteractorData

from BuildingElement               import BuildingElement
from BuildingElementListService    import BuildingElementListService
from BuildingElementPaletteService import BuildingElementPaletteService
from BuildingElementAttributeList  import BuildingElementAttributeList
from ControlPropertiesUtil         import ControlPropertiesUtil

from Utils.GeometryStringValueConverter import GeometryStringValueConverter


PYTHONPART_BUILDER_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_DNS,
    "PythonPartBuilder"
    )

@dataclass(frozen=True)
class RenderKey:
    """ Immutable key used to group geometries sharing identical rendering properties
    in Allplan PythonPart generation.

    This key allows efficient batching of elements that can be drawn with the same
    graphical attributes, reducing redundant property assignments.

    Attributes:
        layer (int): Allplan layer ID.
        pen (int): pen number used for line thickness.
        stroke (int): stroke type (line style).
        color (int): color index.
        pen_by_layer (bool): whether the pen is controlled by the layer.
        stroke_by_layer (bool): whether the stroke is controlled by the layer.
        color_by_layer (bool): whether the color is controlled by the layer.
        help_construction (bool): flag indicating if the geometry is a construction aid.
        surface_path (Optional[str]): path to a surface definition (e.g. hatch, pattern),
            used mainly for 2D or filled elements.
    """
    layer: int
    pen: int
    stroke: int
    color: int
    pen_by_layer: bool
    stroke_by_layer: bool
    color_by_layer: bool
    help_construction: bool
    surface_path: str | None = None

@dataclass
class RenderGroup:
    """ Container grouping geometries that share the same RenderKey.

    This structure is used to batch-create elements in Allplan with identical
    graphical properties, improving performance and code clarity.

    Attributes:
        key (RenderKey): the rendering key defining shared properties.
        geometries (List): list of geometry objects (2D or 3D depending on context).
        common_properties (Optional[object]): optional Allplan CommonProperties
            object applied to all geometries in this group.
    """
    key: RenderKey
    geometries: list = field(default_factory=list)
    common_properties: object | None = None

@dataclass
class GroupedObjects:
    """ Central structure storing grouped geometries for 2D and 3D elements.

    This class separates 2D and 3D geometry batching while using RenderKey
    as a dictionary key to ensure consistent grouping logic.

    Attributes:
        groups_2d (Dict[RenderKey, RenderGroup]): mapping of RenderKey to grouped
            2D geometries.
        groups_3d (Dict[RenderKey, RenderGroup]): mapping of RenderKey to grouped
            3D geometries.
    """
    groups_2d: dict[RenderKey, RenderGroup] = field(default_factory=dict)
    groups_3d: dict[RenderKey, RenderGroup] = field(default_factory=dict)

@dataclass
class VariantData:
    """ Container for one variant, wrapping a full GroupedObjects structure.

    Each variant keeps its own RenderKey-based batching, so geometries with
    shared rendering properties are still grouped efficiently within that
    variant, exactly as in the non-variant version.

    Attributes:
        ref_pnt (Geometry.Point3D): reference point captured for this variant.
        grouped_obj (GroupedObjects): 2D/3D geometries grouped by RenderKey
            for this variant.
    """
    ref_pnt: Geometry.Point3D
    grouped_obj: GroupedObjects = field(default_factory=GroupedObjects)


class MyInteractor(BaseInteractor):
    """ Definition of the interactor class
    """
    def __init__(self,
                 interactor_data: BaseInteractorData) -> None:
        """ Initialization

        Args:
            interactor_data: interactor data
        """
        # Init values
        self.build_ele = cast(BuildingElement, interactor_data.build_ele_list[0])
        self.build_ele_list = interactor_data.build_ele_list
        self.control_props_list = interactor_data.control_props_list
        self.coord_input = interactor_data.coord_input
        self.document = self.coord_input.GetInputViewDocument()
        self.modification_ele_list = interactor_data.modify_uuid_list
        self.selection_result = Input.PostElementSelection()
        self.palette_service: BuildingElementPaletteService = None

        (self.local_str_table, self.global_str_table) = self.build_ele.get_string_tables()

        self.var_qtt = 1
        self.objects_list = []
        self.foils = {}
        self.pyp_path = None
        self.py_path = None

        self.pp_name = ""
        self.com_prop = BaseElements.CommonProperties()
        self.com_prop.GetGlobalProperties()
        self.attr_list = BuildingElementAttributeList()
        self.adap_list = ElementAdapter.BaseElementAdapterList()

        self.var_attr_name = ""
        self.var_attr_values = Utility.VecStringList()
        self.var_attr_id = 0

        # self.grouped_obj = GroupedObjects()
        # self.all_render_groups = ()

        self.variants: dict[int, VariantData] = {}
        self.all_render_groups_by_variant: dict[int, tuple] = {}

        # Init filter
        type_uuids = [
            # 2D objects
            Input.QueryTypeID(ElementAdapter.Point2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Line2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Polyline2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Circle2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Ellipse2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Clothoid2D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Spline2D_TypeUUID),
            # 3D objects
            Input.QueryTypeID(ElementAdapter.Line3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Polyline3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Arc3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Spline3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Volume3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Area3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.BRep3D_Surface_TypeUUID),
            Input.QueryTypeID(ElementAdapter.BRep3D_Wire_TypeUUID),
            Input.QueryTypeID(ElementAdapter.BRep3D_Volume_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Cylinder3D_TypeUUID),
            Input.QueryTypeID(ElementAdapter.Sphere3D_TypeUUID)
            ]
        sel_query = Input.SelectionQuery(type_uuids)
        self.ele_select_filter = Input.ElementSelectFilterSetting(sel_query)

        # Init needed services
        self.palette_service = BuildingElementPaletteService(
            build_ele_list= self.build_ele_list,
            build_ele_composite= interactor_data.build_ele_composite,
            build_ele_script= self.build_ele.script_name,
            build_ele_ctrl_props_list= self.control_props_list,
            picture_path= f"{self.build_ele.pyp_file_path}\\"
            )

        # Show the palette
        self.palette_service.show_palette(self.build_ele.pyp_file_name)

        # Start selection
        self.elements_selection()


    def elements_selection(self,
                           remove_running_selection: bool = False) -> None:
        """ Initializes the input function for selecting multiple elements using InputFunctionStarter.
        Before initializing, it sets up needed filters, based on the values from the property palette:
        - document filter
        - layer filter

        Args:
            remove_running_selection: check if a selection is already running and stop it
        """
        if remove_running_selection:
            Input.InputFunctionStarter.RemoveFunction()

        msg_table = self.local_str_table.get_string("9002", "Select elements")
        Input.InputFunctionStarter.StartElementSelect(
            text= msg_table,
            selectSetting= self.ele_select_filter,
            postSel= self.selection_result,
            markSelectedElements= True
            )


    def process_mouse_msg(self,
                          mouse_msg: int,
                          pnt:       Geometry.Point2D,
                          msg_info:  Input.AddMsgInfo) -> bool:
        """ Method called on each mouse movement, button click or release.

        Args:
            mouse_msg: the mouse message (e.g. 512 - mouse movement)
            pnt:       the input point in view coordinates
            msg_info:  additional message info

        Returns:
            True/False for success
        """
        input_step = self.build_ele.InputStep.value

        if input_step == 0:
            elements = self.selection_result.GetSelectedElements(self.document)

            if len(elements) == 0:
                string_from_table = self.local_str_table.get_string("9001", "No elements selected")
                print(string_from_table)
                self.elements_selection()
                return True

            self.adap_list = elements
            string_from_table = self.local_str_table.get_string("9003", "Reference point")
            prompt_msg = Input.InputStringConvert(string_from_table)
            self.coord_input.InitFirstPointInput(prompt_msg)
            self.build_ele.InputStep.value = 1

        elif input_step == 1:
            input_point = self.coord_input.GetInputPoint(mouse_msg, pnt, msg_info)

            if self.coord_input.IsMouseMove(mouse_msg):
                return True

            ref_pnt = input_point.GetPoint()
            self.foils[ref_pnt] = list(self.adap_list)

            self.build_ele.InputStep.value = 2

            ctrl_prop_util = ControlPropertiesUtil(self.control_props_list, self.build_ele_list)
            ctrl_prop_util.set_enable_function("OKPictureResourceButton", self.return_true)
            ctrl_prop_util.set_enable_function("AddVariantPictureResourceButton", self.return_true)

            string_from_table = self.local_str_table.get_string("9009", "Press OK or add a new variant")
            prompt_msg = Input.InputStringConvert(string_from_table)
            self.coord_input.InitFirstPointInput(prompt_msg)

            self.palette_service.refresh_palette(self.build_ele_list, self.control_props_list)

        return True


    def modify_element_property(self,
                                page:  int,
                                name:  str,
                                value: Any) -> None:
        """ Called after each property modification in the property palette

        Args:
            page:  index of the page, beginning with 0
            name:  name of the modified property
            value: new property value
        """
        update_palette = self.palette_service.modify_element_property(page, name, value)
        if update_palette:
            self.palette_service.update_palette(-1, False)

        # Reinitialize the running element selection to apply new settings from the property palette
        self.elements_selection(remove_running_selection = True)

        self.palette_service.refresh_palette(self.build_ele_list, self.control_props_list)


    def on_control_event(self,
                         event_id: int) -> None:
        """ Called when an event is triggered by a palette control (ex. button)

        Args:
            event_id: id of the triggered event, defined in the tag `<EventId>`
        """
        match event_id:

            case self.build_ele.EXECUTE_SCRIPT:
                self.execute_pp()

            case self.build_ele.ADD_VARIANT:
                self.var_qtt += 1
                self.build_ele.VariantText.value = f"Variant {self.var_qtt}"
                self.build_ele.InputStep.value = 0
                self.palette_service.refresh_palette(self.build_ele_list, self.control_props_list)
                self.elements_selection()


    def on_cancel_function(self) -> bool:
        """ Called when ESC key is pressed.

        Returns:
            True when the PythonPart framework should terminate the PythonPart, False otherwise
        """
        self.palette_service.close_palette()
        Input.InputFunctionStarter.RemoveFunction()

        return True


    def on_cancel_by_menu_function(self) -> None:
        """ Handles the event of terminating the PythonPart by calling another function
        in Allplan UI

        Implement this method, when some actions must be introduced, before the PythonPart
        is eventually terminated.
        """
        self.palette_service.close_palette()


    def on_preview_draw(self) -> None:
        """ Called when an input in the dialog line is done (e.g. input of a coordinate)
        """


    def on_mouse_leave(self) -> None:
        """ Called when the mouse leaves the viewport window
        """


    def on_value_input_control_enter(self) -> bool:
        """ Called when enter key is pressed inside the value input control

        Returns:
            True/False for success
        """
        return True


    def execute_save_favorite(self,
                              file_name: str) -> None:
        """ Save the favorite data

        Args:
            file_name: name of the favorite file
        """
        BuildingElementListService.write_to_file(file_name, self.build_ele_list)


    def execute_load_favorite(self,
                              file_name: str) -> None:
        """ Load the favorite data

        Args:
            file_name: name of the favorite file
        """
        BuildingElementListService.read_from_file(file_name, self.build_ele_list)
        self.palette_service.update_palette(-1, True)


    def update_after_favorite_read(self) -> None:
        """ Update the data after a favorite read
        """
        self.palette_service.update_palette(-1, True)


    def reset_param_values(self,
                           _build_ele_list: list[BuildingElement]) -> None:
        """ Reset the parameter values

        Args:
            _build_ele_list: list with building elements
        """
        BuildingElementListService.reset_param_values(self.build_ele_list)

        self.palette_service.update_palette(-1, True)


    def __del__(self) -> None:
        """ Save the input values at the end of the user interaction
        """
        BuildingElementListService.write_to_default_favorite_file(self.build_ele_list)


    def return_true(self) -> bool:
        """ Utility function

        Returns:
            True
        """
        return True


    def return_false(self) -> bool:
        """ Utility function

        Returns:
            False
        """
        return False


    def generate_pp_uuid(self,
                         part_name: str) -> uuid.UUID:
        """ Create an uuid for the PythonPary

        Args:
            part_name: name of the pythonpart

        Returns:
            UUID for the PythonPart (for the pyp file)
        """
        return uuid.uuid5(PYTHONPART_BUILDER_NAMESPACE, part_name)


    def get_render_key(self,
                       ele: BasisElements.ModelElement2D | BasisElements.ModelElement3D) -> RenderKey | None:
        """ Calculate a key based of render options of the element

        Args:
            ele: allplan element

        Returns:
            render key as object
        """
        if not isinstance(ele, (BasisElements.ModelElement2D, BasisElements.ModelElement3D)):
            return None

        com_prop = ele.GetCommonProperties()
        surface_path = None

        if isinstance(ele, BasisElements.ModelElement3D):
            texture = ele.GetTextureDefinition()
            surface_path = texture.SurfacePath if texture else None

        return RenderKey(
            layer= com_prop.Layer,
            pen= com_prop.Pen,
            stroke= com_prop.Stroke,
            color= com_prop.Color,
            pen_by_layer= com_prop.PenByLayer,
            stroke_by_layer= com_prop.StrokeByLayer,
            color_by_layer= com_prop.ColorByLayer,
            help_construction= com_prop.HelpConstruction,
            surface_path= surface_path
            )


    def get_pythonpart_location_paths(self,
                                      script_name_without_spaces: str) -> tuple[Path, Path]:
        """ Return target paths for .pyp and .py according to the selected location.

        Args:
            script_name_without_spaces: name of the script

        Returns:
            tuple with pyp path and py path
        """
        # Get location from the palette
        location = self.build_ele.LocationRadioGroup.value

        # Get the project name (default: ALLPLAN)
        project_name = "ALLPLAN"
        project_name_normalize = "allplan"

        try:
            # Get the project attributes
            project_attrs = BaseElements.ProjectAttributeService.GetAttributesFromCurrentProject()

            # Get the project name @405@
            for attr_id, attr_value in project_attrs:
                if attr_id == 405:
                    value = str(attr_value).strip()
                    if value:
                        project_name = str(attr_value).strip()
                    break

            # Normalize the project name for py path
            project_name_normalize = unicodedata.normalize("NFKD", project_name)
            project_name_normalize = project_name_normalize.encode("ascii", "ignore").decode("ascii")
            project_name_normalize = project_name_normalize.strip().lower()
            project_name_normalize = re.sub(r"\s+", "_", project_name_normalize)
            project_name_normalize = re.sub(r"[^a-z0-9_]", "_", project_name_normalize)
            project_name_normalize = re.sub(r"_+", "_", project_name_normalize)
            project_name_normalize = project_name_normalize.strip("_") or "allplan"

        except Exception as e:
            string_from_table = self.local_str_table.get_string("9004", "Project name not found:")
            print(f"{string_from_table} {e}")

        if location == "prj":
            root_dir = Path(Settings.AllplanPaths.GetCurPrjPath())
            pyp_dir = root_dir / "Library" / "PythonParts"
            py_dir = root_dir / "PythonPartsScripts"

        elif location == "usr":
            root_dir = Path(Settings.AllplanPaths.GetUsrPath())
            pyp_dir = root_dir / "Library" / "PythonParts" / project_name
            py_dir = root_dir / "PythonPartsScripts" / project_name_normalize

        else: # location == "std"
            root_dir = Path(Settings.AllplanPaths.GetStdPath())
            pyp_dir = root_dir / "Library" / "PythonParts" / project_name
            py_dir = root_dir / "PythonPartsScripts" / project_name_normalize

        pyp_path = pyp_dir / f"{script_name_without_spaces}.pyp"
        py_path = py_dir / f"{script_name_without_spaces}.py"

        return pyp_path, py_path


    def execute_pp(self) -> None:
        """ Execute the script
        """
        # Get parameters
        self.pp_name = self.build_ele.PPNameString.value
        self.attr_list = BuildingElementAttributeList()
        self.attr_list.add_attributes_from_parameters(self.build_ele)

        # Variants
        pp_name = "".join(self.pp_name.split())
        self.var_attr_name = f"{pp_name}_variant"
        self.var_attr_values = Utility.VecStringList()
        for i in range(1, self.var_qtt + 1):
            self.var_attr_values.append(f"variant {i}")

        if self.var_qtt > 1:
            var_attr_has_id = BaseElements.AttributeService.GetAttributeID(self.document, self.var_attr_name)

            if var_attr_has_id == -1:
                self.var_attr_id = BaseElements.AttributeService.AddUserAttribute(
                    doc= self.document,
                    attributeType= BaseElements.AttributeService.AttributeType.Enum,
                    attributeName= self.var_attr_name,
                    attributeDefaultValue= "",
                    attributeMinValue= 0,
                    attributeMaxValue= 60,
                    attributeDimension= "",
                    attributeCtrlType= BaseElements.AttributeService.AttributeControlType.ComboBoxFixed,
                    attributeListValues= self.var_attr_values
                    )

                if self.var_attr_id == -1:
                    string_from_table = self.local_str_table.get_string("9005", "Unable to create attribute:")
                    Utility.ShowMessageBox(
                        text= f"{string_from_table} {self.var_attr_name}",
                        flags= Utility.MB_OK
                        )

            else:
                string_from_table = self.local_str_table.get_string(
                    "9006",
                    "already exists.\nPlease delete it or choose another name for your object"
                    )
                Utility.ShowMessageBox(
                    text= f"{self.var_attr_name} {string_from_table}",
                    flags= Utility.MB_OK
                    )

        if self.pp_name == "":
            string_from_table = self.local_str_table.get_string("9007", "Please enter a name for your PythonPart")
            Utility.ShowMessageBox(
                text= string_from_table,
                flags= Utility.MB_OK
                )

        else:

            self.variants = {}

            for variant_idx, (ref_pnt, adap_list) in enumerate(self.foils.items()):
                variant_data = VariantData(ref_pnt= ref_pnt)

                for adap in adap_list:
                    ele = BaseElements.GetElement(adap)
                    geo = adap.GetModelGeometry()

                    if isinstance(ele, BasisElements.ModelElement2D):
                        moved_geo = Geometry.Move(
                            geo,
                            Geometry.Vector2D(Geometry.Point2D(ref_pnt), Geometry.Point2D())
                            )
                        render_key = self.get_render_key(ele)

                        if render_key is None:
                            continue

                        if render_key not in variant_data.grouped_obj.groups_2d:
                            variant_data.grouped_obj.groups_2d[render_key] = RenderGroup(
                                key= render_key,
                                common_properties= ele.GetCommonProperties()
                                )
                        variant_data.grouped_obj.groups_2d[render_key].geometries.append(moved_geo)

                    elif isinstance(ele, BasisElements.ModelElement3D):
                        moved_geo = Geometry.Move(
                            geo,
                            Geometry.Vector3D(Geometry.Point3D(ref_pnt), Geometry.Point3D())
                            )
                        render_key = self.get_render_key(ele)

                        if render_key is None:
                            continue

                        if render_key not in variant_data.grouped_obj.groups_3d:
                            variant_data.grouped_obj.groups_3d[render_key] = RenderGroup(
                                key= render_key,
                                common_properties= ele.GetCommonProperties()
                                )
                        variant_data.grouped_obj.groups_3d[render_key].geometries.append(moved_geo)

                    else:
                        continue

                self.variants[variant_idx] = variant_data

            script_name = self.build_ele.PPNameString.value
            script_name_without_spaces = "".join(script_name.split())
            self.pyp_path, self.py_path = self.get_pythonpart_location_paths(script_name_without_spaces)

            self.all_render_groups_by_variant = {
                variant_idx: (
                    [(rk, rg, False) for rk, rg in variant_data.grouped_obj.groups_2d.items()] +
                    [(rk, rg, True) for rk, rg in variant_data.grouped_obj.groups_3d.items()]
                    )
                for variant_idx, variant_data in self.variants.items()
                }

            self.create_pyp_file()
            self.create_py_file()


    def create_pyp_file(self) -> None:
        """ Generate palette for the pythonpart
        """
        attr_list = self.attr_list.get_attributes_list_as_tuples() if self.attr_list else []
        attr_list = attr_list + [(0,)]
        attr_list_str = "[" + ";".join(
            f"({att[0]},{att[1]})" if len(att) == 2 else f"({att[0]},)"
            for att in attr_list
            ) + "]"

        write_file = True
        script_name = self.build_ele.PPNameString.value
        script_name_without_spaces = "".join(script_name.split())
        pp_uuid = self.generate_pp_uuid(script_name_without_spaces)

        if self.pyp_path.is_file():
            string_from_table = self.local_str_table.get_string("9008", "Do you want to overwrite the existing")
            ret = Utility.ShowMessageBox(
                text= f"{string_from_table} {script_name_without_spaces}.pyp?",
                flags= Utility.MB_YESNO
                )
            if ret == 7:
                write_file = False

        if write_file:

            # ----
            # Start of pyp file
            # ----

            xsi_ns = "http://www.w3.org/2001/XMLSchema-instance"
            ET.register_namespace('xsi', xsi_ns)

            # ----
            # <Element>
            # ----

            root = ET.Element(
                "Element",
                {
                    f"{{{xsi_ns}}}noNamespaceSchemaLocation": (
                        "https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd"
                    )
                }
                )

            # ----
            # <Script>
            # ----

            script = ET.SubElement(root, "Script")
            py_relative_parts = self.py_path.parts
            pythonpartsscripts_index = py_relative_parts.index("PythonPartsScripts")
            script_relative_path = "\\".join(py_relative_parts[pythonpartsscripts_index + 1:])
            ET.SubElement(script, "Name").text = script_relative_path
            ET.SubElement(script, "Title").text = script_name
            ET.SubElement(script, "AttributeEvent").text = "True"
            ET.SubElement(script, "Version").text = "1.0"
            ET.SubElement(script, "Uuid").text = str(pp_uuid)

            # ----
            # <Global Page>
            # ----

            global_page = ET.SubElement(root, "Page")
            ET.SubElement(global_page, "Name").text = "GlobalPage"
            ET.SubElement(global_page, "Text").text = "Global data"
            ET.SubElement(global_page, "TextId").text = "e_GLOBAL_DATA"

            # <Parameters>
            global_param = ET.SubElement(global_page, "Parameters")

            # <Attributes Expander>
            attr_expand = ET.SubElement(global_param, "Parameter")
            ET.SubElement(attr_expand, "Name").text = "AttributesExpander"
            ET.SubElement(attr_expand, "Text").text = "Attributes"
            ET.SubElement(attr_expand, "ValueType").text = "Expander"

            attr_expand_param = ET.SubElement(attr_expand, "Parameters")

            # <Variant Attribute>
            if self.var_qtt > 1:
                var_param = ET.SubElement(attr_expand_param, "Parameter")
                ET.SubElement(var_param, "Name").text = "VariantAttribute"
                ET.SubElement(var_param, "Text").text = "Aspect"
                ET.SubElement(var_param, "TextId").text = "e_ASPECT"
                ET.SubElement(var_param, "Value").text = "0"
                ET.SubElement(var_param, "ValueType").text = "Attribute"
                ET.SubElement(var_param, "AttributeId").text = str(self.var_attr_id)

                # <Separator>
                sep_param = ET.SubElement(attr_expand_param, "Parameter")
                ET.SubElement(sep_param, "Name").text = "Separator"
                ET.SubElement(sep_param, "ValueType").text = "Separator"

            # <Dynamic Attributes>
            dyn_attr_param = ET.SubElement(attr_expand_param, "Parameter")
            ET.SubElement(dyn_attr_param, "Name").text = "DynamicAttributeList"
            ET.SubElement(dyn_attr_param, "Text").text = "Attributes"
            ET.SubElement(dyn_attr_param, "Value").text = attr_list_str
            ET.SubElement(dyn_attr_param, "ValueType").text = "AttributeIdValue"
            ET.SubElement(dyn_attr_param, "ValueDialog").text = "AttributeSelection"

            # ----
            # <Format Page>
            # ----

            format_page = ET.SubElement(root, "Page")
            ET.SubElement(format_page, "Name").text = "FormatPage"
            ET.SubElement(format_page, "Text").text = "Format"
            ET.SubElement(format_page, "TextId").text = "e_FORMAT"

            # <Parameters>
            format_param = ET.SubElement(format_page, "Parameters")

            # <Common Properties>
            if not self.all_render_groups_by_variant or not any(self.all_render_groups_by_variant.values()):
                com_prop_param = ET.SubElement(format_param, "Parameter")
                ET.SubElement(com_prop_param, "Name").text = "CommonProp"
                ET.SubElement(com_prop_param, "Text").text = ""
                ET.SubElement(com_prop_param, "Value").text = (
                    f"CommonProperties(Pen({int(self.com_prop.Pen)})),"
                    f"CommonProperties(Stroke({int(self.com_prop.Stroke)})),"
                    f"CommonProperties(Color({int(self.com_prop.Color)})),"
                    f"CommonProperties(Layer({int(self.com_prop.Layer)})),"
                    f"CommonProperties(PenByLayer({int(self.com_prop.PenByLayer)})),"
                    f"CommonProperties(StrokeByLayer({int(self.com_prop.StrokeByLayer)})),"
                    f"CommonProperties(ColorByLayer({int(self.com_prop.ColorByLayer)})),"
                    f"CommonProperties(HelpConstruction({int(self.com_prop.HelpConstruction)}))"
                    )
                ET.SubElement(com_prop_param, "ValueType").text = "CommonProperties"
                ET.SubElement(com_prop_param, "Visible").text = "|DrawOrder:False"

            for variant_idx, render_groups in self.all_render_groups_by_variant.items():
                for i, (render_key, render_group, is_3d) in enumerate(render_groups):
                    com_prop = render_group.common_properties

                    com_prop_expand = ET.SubElement(format_param, "Parameter")
                    ET.SubElement(com_prop_expand, "Name").text = f"CommonProp_{variant_idx}_{i}_Expander"
                    ET.SubElement(com_prop_expand, "Text").text = f"Variant {variant_idx + 1} - Format {i + 1}"
                    ET.SubElement(com_prop_expand, "ValueType").text = "Expander"
                    ET.SubElement(com_prop_expand, "Visible").text = f"VariantAttribute == 'variant {variant_idx + 1}'"

                    com_prop_expand_param = ET.SubElement(com_prop_expand, "Parameters")

                    com_prop_param = ET.SubElement(com_prop_expand_param, "Parameter")
                    ET.SubElement(com_prop_param, "Name").text = f"CommonProp_{variant_idx}_{i}"
                    ET.SubElement(com_prop_param, "Text").text = ""
                    ET.SubElement(com_prop_param, "Value").text = (
                        f"CommonProperties(Pen({int(com_prop.Pen)})),"
                        f"CommonProperties(Stroke({int(com_prop.Stroke)})),"
                        f"CommonProperties(Color({int(com_prop.Color)})),"
                        f"CommonProperties(Layer({int(com_prop.Layer)})),"
                        f"CommonProperties(PenByLayer({int(com_prop.PenByLayer)})),"
                        f"CommonProperties(StrokeByLayer({int(com_prop.StrokeByLayer)})),"
                        f"CommonProperties(ColorByLayer({int(com_prop.ColorByLayer)})),"
                        f"CommonProperties(HelpConstruction({int(com_prop.HelpConstruction)}))"
                        )
                    ET.SubElement(com_prop_param, "ValueType").text = "CommonProperties"
                    ET.SubElement(com_prop_param, "Visible").text = "|DrawOrder:False"

                    if is_3d:
                        material_param = ET.SubElement(com_prop_expand_param, "Parameter")
                        ET.SubElement(material_param, "Name").text = f"MaterialButton_{variant_idx}_{i}"
                        ET.SubElement(material_param, "Text").text = "Material"
                        ET.SubElement(material_param, "Value").text = render_key.surface_path or ""
                        ET.SubElement(material_param, "ValueType").text = "MaterialButton"
                        ET.SubElement(material_param, "DisableButtonIsShown").text = "True"

            # ----
            # <Hidden Page>
            # ----

            hid_page = ET.SubElement(root, "Page")
            ET.SubElement(hid_page, "Name").text = "__HiddenPage__"
            ET.SubElement(hid_page, "Text")

            # <Parameters>
            hid_param = ET.SubElement(hid_page, "Parameters")

            # Geometry
            for variant_idx, render_groups in self.all_render_groups_by_variant.items():
                for i, (render_key, render_group, is_3d) in enumerate(render_groups):
                    geo_strings = [
                        GeometryStringValueConverter.to_string(geo)
                        for geo in render_group.geometries
                        ]
                    geo_value = f"[{';'.join(geo_strings)}]"

                    geo_param = ET.SubElement(hid_param, "Parameter")
                    ET.SubElement(geo_param, "Name").text = f"GeometryList_{variant_idx}_{i}"
                    ET.SubElement(geo_param, "Value").text = geo_value
                    ET.SubElement(geo_param, "ValueType").text = "GeometryObject"

            # Count
            count_param = ET.SubElement(hid_param, "Parameter")
            ET.SubElement(count_param, "Name").text = "VariantCount"
            ET.SubElement(count_param, "Value").text = str(len(self.all_render_groups_by_variant))
            ET.SubElement(count_param, "ValueType").text = "Integer"

            for variant_idx, render_groups in self.all_render_groups_by_variant.items():
                group_count_param = ET.SubElement(hid_param, "Parameter")
                ET.SubElement(group_count_param, "Name").text = f"GroupCount_{variant_idx}"
                ET.SubElement(group_count_param, "Value").text = str(len(render_groups))
                ET.SubElement(group_count_param, "ValueType").text = "Integer"

                for i, (render_key, render_group, is_3d) in enumerate(render_groups):
                    is_3d_param = ET.SubElement(hid_param, "Parameter")
                    ET.SubElement(is_3d_param, "Name").text = f"IsGroup3D_{variant_idx}_{i}"
                    ET.SubElement(is_3d_param, "Value").text = str(int(is_3d))
                    ET.SubElement(is_3d_param, "ValueType").text = "Integer"

            # ----
            # End of pyp file
            # ----

            self.pyp_path.parent.mkdir(parents= True, exist_ok= True)

            tree = ET.ElementTree(root)
            ET.indent(tree= tree, space= "    ", level= 0)
            tree.write(self.pyp_path, encoding= "utf-8", xml_declaration= True)


    def create_py_file(self) -> None:
        """ Generate main script for the pythonpart
        """
        write_file = True
        script_name = self.build_ele.PPNameString.value
        script_name = "".join(script_name.split())

        var_list = []
        for variant in self.var_attr_values:
            var_list.append(str(variant))

        if self.py_path.is_file():
            string_from_table = self.local_str_table.get_string("9008", "Do you want to overwrite the existing")
            ret = Utility.ShowMessageBox(
                text= f"{string_from_table} {script_name}.py?",
                flags= Utility.MB_YESNO
                )
            if ret == 7:
                write_file = False

        if write_file:

            code = f'''""" {script_name}.py - generated by PythonPartBuilder
Copyright © {date.today().year} ALLPLAN FRANCE
"""
from __future__ import annotations

from typing import cast

import NemAll_Python_BasisElements   as BasisElements
import NemAll_Python_AllplanSettings as Settings

from BaseScriptObject import BaseScriptObject
from BaseScriptObject import BaseScriptObjectData

from CreateElementResult          import CreateElementResult
from BuildingElement              import BuildingElement
from BuildingElementAttributeList import BuildingElementAttributeList
from TypeCollections.ModelEleList import ModelEleList
from PythonPartUtil               import PythonPartUtil


def check_allplan_version(_build_ele: BuildingElement,
                          version:    str) -> bool:
    """ Called when the PythonPart is started to check if the current Allplan version is supported.

    Args:
        _build_ele: building element with the parameter properties
        version:    current Allplan version

    Returns:
        True if current Allplan version is supported and PythonPart script can be run, False otherwise
    """
    return float(version) >= 2026


def create_script_object(build_ele:          BuildingElement,
                         script_object_data: BaseScriptObjectData) -> BaseScriptObject:
    """ Creation of the script object

    Args:
        build_ele:          building element with the parameter properties
        script_object_data: script object data

    Returns:
        created script object
    """
    return MyScriptObject(build_ele, script_object_data)


class MyScriptObject(BaseScriptObject):
    """ Implementation of the class
    """
    def __init__(self,
                 build_ele:          BuildingElement,
                 script_object_data: BaseScriptObjectData) -> None:
        """ Initialization

        Args:
            build_ele:          building element with the parameter properties
            script_object_data: script object data
        """
        super().__init__(script_object_data)

        self.build_ele = cast(BuildingElement, build_ele)
        self.is_modification_mode = self.execution_event != Settings.ExecutionEvent.eCreation


    def start_input(self) -> None:
        """ No input
        """
        self.script_object_interactor = None


    def execute(self) -> CreateElementResult:
        """ Execute the script

        Returns:
            created element result
        """
        pyp_util = PythonPartUtil()
        model_ele_list = ModelEleList()

        # ----
        # Get parameters from the palette
        # ----

        variant_count = self.build_ele.VariantCount.value
        if variant_count > 1:
            variant_value = self.build_ele.VariantAttribute.value
            variant_idx = int(variant_value.replace("variant ", "")) - 1
        else:
            variant_idx = 0

        group_count_attr = getattr(self.build_ele, f"GroupCount_{{variant_idx}}", None)
        group_count = group_count_attr.value if group_count_attr is not None else 0

        # ----
        # Geometry
        # ----

        for i in range(group_count):
            com_prop = getattr(self.build_ele, f"CommonProp_{{variant_idx}}_{{i}}").value
            geo_list = getattr(self.build_ele, f"GeometryList_{{variant_idx}}_{{i}}").value
            is_3d = bool(getattr(self.build_ele, f"IsGroup3D_{{variant_idx}}_{{i}}").value)
            material = getattr(self.build_ele, f"MaterialButton_{{variant_idx}}_{{i}}").value
            texture = None

            if material != '':
                texture = BasisElements.TextureDefinition(material)

            for geo in geo_list:
                if not is_3d:
                    model_ele_list.append_geometry_2d(geo, com_prop)
                elif texture:
                    model_ele_list.append_geometry_3d_with_texture(geo, texture, com_prop)
                else:
                    model_ele_list.append_geometry_3d(geo, com_prop)

        # ----
        # Attributes
        # ----

        attr_list = BuildingElementAttributeList()
        attr_list.add_attributes_from_parameters(self.build_ele)
        pyp_util.add_attribute_list(attr_list)

        # ----
        # Create pythonpart
        # ----

        pyp_util.add_pythonpart_view_2d3d(model_ele_list)
        pythonpart = pyp_util.create_pythonpart(
            build_ele= self.build_ele,
            type_display_name= "{self.pp_name}"
            )

        return CreateElementResult(pythonpart)
'''

            self.py_path.parent.mkdir(parents=True, exist_ok=True)
            self.py_path.write_text(code, encoding="utf-8")

            string_from_table = self.local_str_table.get_string("9010", "successfully created!")
            Utility.ShowMessageBox(
                text= f"{self.pp_name} {string_from_table}",
                flags= Utility.MB_OK
                )
            keyboard.press_and_release('esc')
