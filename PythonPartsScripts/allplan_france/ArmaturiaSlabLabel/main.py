# -*- coding: utf-8 -*-
""" ScriptObject PythonPart

Copyright © 2026 ALLPLAN FRANCE
"""

from __future__ import annotations

import hashlib
import math
import time
import re

from typing          import Any, cast, NamedTuple
from dataclasses     import dataclass
from collections.abc import Generator

import NemAll_Python_BaseElements       as BaseElements
import NemAll_Python_BasisElements      as BasisElements
import NemAll_Python_IFW_ElementAdapter as ElementAdapter
import NemAll_Python_Geometry           as Geometry
import NemAll_Python_IFW_Input          as Input
import NemAll_Python_AllplanSettings    as Settings

from BaseScriptObject import BaseScriptObject
from BaseScriptObject import BaseScriptObjectData

from ScriptObjectInteractors.BaseFilterObject             import BaseFilterObject
from ScriptObjectInteractors.MultiElementSelectInteractor import MultiElementSelectInteractor
from ScriptObjectInteractors.MultiElementSelectInteractor import MultiElementSelectInteractorResult

from CreateElementResult          import CreateElementResult
from BuildingElement              import BuildingElement
from TypeCollections.ModelEleList import ModelEleList
from PythonPartUtil               import PythonPartUtil
from PythonPartViewData           import PythonPartViewData
from PythonPartTransaction        import PythonPartTransaction
from PythonPartTransaction        import ConnectToElements

from Utils.ElementFilter.FilterCollection import FilterCollection


class CurrentDfFilter(BaseFilterObject):
    """ CurrentDfFilter class
    """
    def __init__(self) -> None:
        self._active_df = BaseElements.DrawingFileService.GetActiveFileNumber()

    def __call__(self,
                 element: ElementAdapter.BaseElementAdapter) -> bool:
        return element.GetDrawingfileNumber() == self._active_df


class SlabLayerElevation(NamedTuple):
    """ SlabLayerElevation class
    """
    z_max: float
    z_min: float
    height: float
    adapter: ElementAdapter.BaseElementAdapter


@dataclass(frozen= True)
class ScaleBands:
    """ Named collection of scale bands (low/mid/high)

    Attributes:
        low:  band covering the lowest scale range
        mid:  band covering the intermediate scale range
        high: band covering the highest scale range
    """
    low:  ScaleBand
    mid:  ScaleBand
    high: ScaleBand


    def __iter__(self) -> Generator[ScaleBand, Any, None]:
        """ Iterate over the bands in low/mid/high order

        Yields:
            each ScaleBand, in low/mid/high order
        """
        yield self.low
        yield self.mid
        yield self.high


    def for_scale(self,
                  scale: float) -> ScaleBand:
        """ Return the band matching the given scale value

        Args:
            scale: current view/document scale

        Returns:
            matching ScaleBand (fallback: highest band)
        """
        for band in self:
            if band.start_scale <= scale <= band.end_scale:
                return band
        return self.high


@dataclass
class ScaleBand:
    """ Defines a scale level and the factor associated
    """
    name: str
    start_scale: float
    end_scale: float
    factor: float


@dataclass
class ScaleTextProperties:
    """ Text properties bundle (struct/finish/thick) for a given scale band

    Attributes:
        struct: text properties for the structural level label
        finish: text properties for the finished floor level label
        thick:  text properties for the thickness label
    """
    struct: BasisElements.TextProperties
    finish: BasisElements.TextProperties
    thick:  BasisElements.TextProperties


@dataclass
class TextPropertiesByScale:
    """ Text properties bundle, one ScaleTextProperties set per scale band

    Attributes:
        low:  text properties for the low scale band
        mid:  text properties for the mid scale band
        high: text properties for the high scale band
    """
    low:  ScaleTextProperties
    mid:  ScaleTextProperties
    high: ScaleTextProperties


    def __iter__(self) -> Generator[ScaleTextProperties, Any, None]:
        """ Iterate over the property sets in low/mid/high order

        Yields:
            each ScaleTextProperties, in low/mid/high order
        """
        yield self.low
        yield self.mid
        yield self.high


    def for_scale(self, scale: float) -> ScaleTextProperties:
        """ Return the properties matching the given scale value


        Args:
            scale: current view/document scale


        Returns:
            matching ScaleTextProperties (fallback: highest band)
        """
        for band, props in zip(SCALE_BANDS, self):
            if band.start_scale <= scale <= band.end_scale:
                return props
        return self.high


SCALE_BANDS = ScaleBands(
    low=  ScaleBand(name= "low",  start_scale= 0,   end_scale= 50,   factor= 1),
    mid=  ScaleBand(name= "mid",  start_scale= 50,  end_scale= 100,  factor= 2),
    high= ScaleBand(name= "high", start_scale= 100, end_scale= 9999, factor= 4)
    )

SPAN_DIRECTIONS = {
    1: ((-1, 0), (1, 0)),
    2: ((0, 1), (0, -1)),
    3: ((0, 1), (0, -1), (-1, 0), (1, 0))
    }

THICKNESS_SUM = re.compile(
    r"\s*[0-9]+(?:[.,][0-9]+)?"
    r"(?:\s*\+\s*[0-9]+(?:[.,][0-9]+)?)*\s*"
    )

DISPLAY_NAME = "PySlabLabel"


class MyScriptObject(BaseScriptObject):
    """ Definition of the script object class
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

        self.selection_result = MultiElementSelectInteractorResult()

        self.allowed_types = [ElementAdapter.Slab_TypeUUID]
        self.element_filter = FilterCollection(and_filter = True)
        self.element_filter.append(Input.SelectionQuery([Input.QueryTypeID(ele_type) for ele_type in self.allowed_types]))
        self.element_filter.append(CurrentDfFilter())

        self.base_scale = 50
        self.current_scale = self.document.GetScalingFactor()
        self.base_pnt = Settings.AllplanGlobalSettings.GetOffsetPoint()
        self.build_ele.GeorefZOffset.value = self.base_pnt.Z

        self.readstate= BaseElements.eAttibuteReadState.ReadAllAndComputable

        self.text_props = self._build_text_properties()

        self.slab_analysed = []


    def start_input(self) -> None:
        """ First input
        """
        if not self.is_modification_mode:

            self.script_object_interactor = MultiElementSelectInteractor(
                interactor_result= self.selection_result,
                ele_filter= self.element_filter,
                prompt_msg = "Select the elements"
                )

        else:

            # ----
            # Manual move of the PythonPart
            # ----

            if self.execution_event == Settings.ExecutionEvent.eMove:

                current_vector = self.modification_matrix.GetTranslationVector()
                origin_pnt = self.build_ele.GravityPoint.value
                current_pnt = Geometry.Move(self.build_ele.InputPoint.value, current_vector)

                self.build_ele.VectorOffset.value = Geometry.Vector3D(origin_pnt, current_pnt)
                self.build_ele.InputPoint.value = current_pnt

            # ----
            # Modification of connected element
            # ----

            elif self.execution_event == Settings.ExecutionEvent.eConnection:

                # Delete pythonpart if no more slab
                pp = self.modification_ele_list.get_base_element_adapter(self.document)
                obs_ele = BaseElements.AssociationService.GetObservedElements(self.document, pp.GetModelElementUUID())
                if not obs_ele or not obs_ele[0].IsValid():
                    ele_adap_list = ElementAdapter.BaseElementAdapterList()
                    ele_adap_list.append(pp)
                    BaseElements.DeleteElements(self.document, ele_adap_list)

            self.script_object_interactor = None


    def start_next_input(self) -> None:
        """ Next inputs
        """
        if not self.is_modification_mode:
            self.script_object_interactor = None


    def execute(self) -> CreateElementResult:
        """ Execute the script

        Returns:
            created element result
        """

        # ----
        # Modification mode
        # ----

        if self.is_modification_mode:
            pythonpart_uuid  = self.modification_ele_list.get_base_element_adapter(self.document).GetModelElementUUID()
            observed_elements = BaseElements.AssociationService.GetObservedElements(self.document, pythonpart_uuid)
            if len(observed_elements) != 0:
                adap = observed_elements[0]
                self.create_pp(adap)
            else:
                return CreateElementResult()

        # ----
        # Creation mode
        # ----

        else:
            source_elements = self.selection_result.sel_elements

            for adap in source_elements:
                if adap == ElementAdapter.Slab_TypeUUID:

                    total_slab_adap = ElementAdapter.BaseElementAdapterParentElementService.GetParentElement(adap)

                    if (total_slab_guid := total_slab_adap.GetModelElementUUID()) not in self.slab_analysed:
                        self.slab_analysed.append(total_slab_guid)
                        self.create_pp(total_slab_adap)

        return CreateElementResult()


    def modify_element_property(self,
                                name:   str,
                                _value: Any) -> bool:
        """ Modify property of element

        Args:
            name:   the name of the property.
            _value: new value for property.

        Returns:
            palette update state
        """
        match name:

            case "CustomThickValue":
                height = float(self.build_ele.InitThickValue.value.strip("() "))
                self.check_thickness_text(self.build_ele.CustomThickValue.value or "", height)

        return True


    def on_control_event(self,
                         event_id: int) -> bool:
        """ Handles the on control event

        Args:
            event_id: event id of the clicked button control

        Returns:
            update palette state
        """
        interval_value = 1

        match event_id:

            # Z Rotation
            case self.build_ele.R0T_Z_MINUS:
                self.build_ele.ZRotation.value = max(-89, self.build_ele.ZRotation.value - interval_value)
            case self.build_ele.R0T_Z_PLUS:
                self.build_ele.ZRotation.value = min(89, self.build_ele.ZRotation.value + interval_value)

        return True


    def create_pp(self,
                  slab_adap: ElementAdapter.BaseElementAdapter) -> None:
        """ Create the pythonpart per slab

        Args:
            slab_adap: source element for association
        """

        # ----
        # Get parameters from the palette
        # ----

        com_prop = self.build_ele.LabelCommonProp.value
        span_prop = BaseElements.CommonProperties(com_prop)
        span_prop.Pen = 4
        span_dir = self.build_ele.SpanningDirection.value
        span_rot = self.build_ele.ZRotation.value
        lead_line = self.build_ele.LeaderLine.value
        has_georef_offset = self.build_ele.GeorefPointOffset.value
        has_custom_thick = self.build_ele.CustomThickCheckbox.value
        if has_custom_thick:
            custom_thick = self.build_ele.CustomThickValue.value or ""
        thick_unit = self.build_ele.ThicknessUnit.value
        show_finish_lvl = self.build_ele.ShowFinishedFloorLevel.value
        show_load_class = self.build_ele.ShowLoadClass.value
        vector_offset = Geometry.Vector2D(self.build_ele.VectorOffset.value)

        # ----
        # Source element
        # ----

        attributes = dict(slab_adap.GetAttributes(self.readstate))
        load_class = attributes.get(18280, "")

        children = ElementAdapter.BaseElementAdapterChildElementsService.GetChildModelElementsFromTree(slab_adap)

        elevations: dict[ElementAdapter.GUID, SlabLayerElevation] = {}
        center_slab = Geometry.Point3DList()

        for child in children:

            if child != ElementAdapter.Slab_TypeUUID:
                continue

            geo = cast(Geometry.Polyhedron3D, child.GetModelGeometry())
            if isinstance(geo, Geometry.Polyhedron3D) and geo.IsValid():
                count = geo.GetVerticesCount()
                z_max = round(max(geo.GetVertex(i)[1].Z for i in range(count)))
                z_min = round(min(geo.GetVertex(i)[1].Z for i in range(count)))
                height = int((z_max - z_min) / 10) if thick_unit == "cm" else round((z_max - z_min) / 1000, 3)
                elevations[child.GetModelElementUUID()] = SlabLayerElevation(z_max, z_min, height, child)
                _err, _volume, _surface, center_of_gravity = Geometry.CalcMass(geo)
                center_slab.append(center_of_gravity)

        if not elevations:
            return

        layers = sorted(elevations.values(), key=lambda l: l.z_max)
        is_multilayer = len(layers) > 1
        bot_layer, top_layer = layers[0], layers[-1]
        self.build_ele.InitThickValue.value = f"( {bot_layer.height} )"

        # Gravity center of the total slab

        gravity_pnt = Geometry.Line3D(
            center_slab[0],
            center_slab[-1]
            ).GetCenterPoint()

        # Footprint

        thickest_layer = max(layers, key=lambda l: l.height)
        footprint = cast(Geometry.Polyline2D, thickest_layer.adapter.GetGroundViewArchitectureElementGeometry())
        footprint = Geometry.Polygon2D(footprint.Points)

        # Spanning direction

        SQUARE_TOL = 0.95

        if not self.is_modification_mode:

            span_dir = 0
            span_rot = 0
            err, lines = footprint.GetSegments()

            if err == Geometry.eGeometryErrorCode.eOK:

                if not lines or len(lines) != 4:
                    span_dir = 0

                else:

                    x_vector = Geometry.Vector2D(1, 0)
                    y_vector = Geometry.Vector2D(0, 1)

                    segments = []
                    for line in lines:
                        vec = line.GetVector()
                        vec_norm = Geometry.Vector2D(vec)
                        vec_norm.Normalize()
                        length = vec.GetLength()

                        segments.append({
                            "line": line,
                            "vec": vec,
                            "vec_norm": vec_norm,
                            "length": length
                            })

                    segments.sort(key=lambda s: s["length"], reverse= True)

                    max_length = segments[0]["length"]
                    min_length = segments[-1]["length"]

                    main: Geometry.Vector2D = segments[0]["vec_norm"]
                    if main.X < 0 or (abs(main.X) < 1E-6 and main.Y < 0):
                        main.Reverse()

                    if (min_length / max_length) >= SQUARE_TOL:
                        span_dir = 3

                    else:
                        dot_x = abs(main.DotProduct(x_vector))
                        dot_y = abs(main.DotProduct(y_vector))

                        if dot_x >= dot_y:
                            span_dir = 2
                        else:
                            span_dir = 1

                    span_rot = round((main.GetAngleSigned().Deg), 2)
                    if math.isclose(abs(span_rot), 90, abs_tol=1E-6):
                        span_rot = 0

            self.build_ele.ZRotation.value = span_rot
            self.build_ele.SpanningDirection.value = span_dir

        # Corners

        footprint_bot_left = Geometry.Point2D()
        footprint_bot_right = Geometry.Point2D()
        footprint_top_left = Geometry.Point2D()
        footprint_top_right = Geometry.Point2D()

        if footprint.IsValid():
            corner_pnts = footprint.Points[:-1]

            a = math.radians(span_rot)
            ux = math.cos(a)
            uy = math.sin(a)

            vx = -uy
            vy = ux

            local_pnts = []

            for p in corner_pnts:
                dx = p.X - gravity_pnt.X
                dy = p.Y - gravity_pnt.Y

                lx = dx * ux + dy * uy
                ly = dx * vx + dy * vy

                local_pnts.append({
                    "global": p,
                    "local": Geometry.Point2D(lx, ly)
                    })

            PNT_TOL = 1E-6
            _r = lambda v: round(v / PNT_TOL)

            bl = min(local_pnts, key=lambda p: (_r(p["local"].Y), _r(p["local"].X)))
            br = min(local_pnts, key=lambda p: (_r(p["local"].Y), -_r(p["local"].X)))
            tl = min(local_pnts, key=lambda p: (-_r(p["local"].Y), _r(p["local"].X)))
            tr = min(local_pnts, key=lambda p: (-_r(p["local"].Y), -_r(p["local"].X)))

            footprint_bot_left  = Geometry.Point2D(bl["global"].X - gravity_pnt.X, bl["global"].Y - gravity_pnt.Y)
            footprint_bot_right = Geometry.Point2D(br["global"].X - gravity_pnt.X, br["global"].Y - gravity_pnt.Y)
            footprint_top_left  = Geometry.Point2D(tl["global"].X - gravity_pnt.X, tl["global"].Y - gravity_pnt.Y)
            footprint_top_right = Geometry.Point2D(tr["global"].X - gravity_pnt.X, tr["global"].Y - gravity_pnt.Y)

        # ----
        # Create geometry
        # ----

        # Hypothesis

        size = 350
        offset = 50
        arrow = 150

        # Basis

        base_geo = []

        ext_circle = Geometry.Arc2D(
            center= Geometry.Point2D(),
            radius= size)
        base_geo.append(ext_circle)

        int_circle = Geometry.Arc2D(
            center= Geometry.Point2D(),
            minor= size - offset,
            major= size - offset,
            axisangle= Geometry.Angle.DegToRad(180),
            startangle= 0,
            endangle= Geometry.Angle.DegToRad(180)
            )
        base_geo.append(int_circle)

        line = Geometry.Line2D(
            point1= int_circle.StartPoint,
            point2= int_circle.EndPoint
            )
        base_geo.append(line)

        left_start_pnt = Geometry.Point2D(-size, 0)
        base_geo.append(left_start_pnt)

        right_start_pnt = Geometry.Point2D(size, 0)
        base_geo.append(right_start_pnt)

        # Spanning direction

        base_span_dir = []

        for ux, uy in SPAN_DIRECTIONS.get(span_dir, ()):
            vx, vy = -uy, ux

            tip = Geometry.Point2D(ux * size * 2, uy * size * 2)

            base_span_dir.append(Geometry.Line2D(Geometry.Point2D(ux * size, uy * size), tip))
            base_span_dir.append(Geometry.Line2D(tip, Geometry.Point2D(
                tip.X - arrow * ux + arrow / 2 * vx,
                tip.Y - arrow * uy + arrow / 2 * vy
                )))

        rot_pnt = Geometry.Point2D()
        rot_angle = Geometry.Angle.FromDeg(span_rot)
        rot_span_dir = [Geometry.Rotate(span, rot_pnt, rot_angle) for span in base_span_dir]

        # ----
        # Model elements
        # ----

        model_ele_lists = {}

        for band in SCALE_BANDS:
            band_matrix = Geometry.Matrix2D()
            band_matrix.SetScaling(band.factor, band.factor)

            target_list = ModelEleList(com_prop= com_prop)

            for source_geo in base_geo:
                # Anchor points are handled separately for leader lines
                if isinstance(source_geo, Geometry.Point2D):
                    continue

                # Copy before transforming to preserve the source geometry
                if isinstance(source_geo, Geometry.Arc2D):
                    scaled_geo = Geometry.Arc2D(source_geo) * band_matrix
                elif isinstance(source_geo, Geometry.Line2D):
                    scaled_geo = Geometry.Line2D(source_geo) * band_matrix
                else:
                    raise TypeError(
                        f"Unsupported label geometry: {type(source_geo).__name__}"
                        )

                # Apply the displacement after scaling
                placed_geo = Geometry.Move(scaled_geo, vector_offset)
                target_list.append_geometry_2d(placed_geo)

            for source_span in rot_span_dir:
                # Spanning arrows already include their rotation, but no displacement
                scaled_span = Geometry.Line2D(source_span) * band_matrix
                placed_span = Geometry.Move(scaled_span, vector_offset)

                target_list.append_geometry_2d(placed_span, span_prop)

            model_ele_lists[band.name] = target_list

        # Independent lists used later when creating the PythonPart views
        low_model_ele_list = model_ele_lists["low"]
        mid_model_ele_list = model_ele_lists["mid"]
        high_model_ele_list = model_ele_lists["high"]

        # ----
        # Create text
        # ----

        z_offset = self.base_pnt.Z if has_georef_offset else 0

        finish_lvl_txt_origin = Geometry.Point2D(0, 240)
        struct_lvl_text_origin = Geometry.Point2D(0, 80)
        thick_text_origin = Geometry.Point2D(0, -125)
        load_text_origin = Geometry.Point2D(500, -450)

        for band, txt_props in zip(SCALE_BANDS, self.text_props):

            band_matrix = Geometry.Matrix2D()
            band_matrix.SetScaling(band.factor, band.factor)

            target_list = model_ele_lists[band.name]

            if show_finish_lvl and is_multilayer:
                finish_lvl_txt = self._format_altitude(top_layer.z_max + z_offset)
                finish_lvl_txt = BasisElements.TextElement(
                    com_prop, txt_props.finish, finish_lvl_txt,
                    Geometry.Move(finish_lvl_txt_origin * band_matrix, vector_offset)
                    )
                target_list.append(finish_lvl_txt)

            struct_lvl_text = self._format_altitude(bot_layer.z_max + z_offset)
            struct_lvl_text = BasisElements.TextElement(
                com_prop, txt_props.struct, struct_lvl_text,
                Geometry.Move(struct_lvl_text_origin * band_matrix, vector_offset)
                )
            target_list.append(struct_lvl_text)

            if has_custom_thick:
                thick_text = custom_thick
            else:
                thick_text = str(bot_layer.height) if thick_unit == "cm" else f"{bot_layer.height:.3f}"
            thick_text = BasisElements.TextElement(
                com_prop, txt_props.thick, thick_text,
                Geometry.Move(thick_text_origin * band_matrix, vector_offset)
                )
            target_list.append(thick_text)

            # Show 'load class' attribute @18280@
            if show_load_class and load_class != "":
                load_text = str(load_class)
                load_text = BasisElements.TextElement(
                    com_prop, txt_props.thick, load_text,
                    Geometry.Move(load_text_origin * band_matrix, vector_offset)
                    )
                target_list.append(load_text)

        # ----
        # Diagonal corners
        # ----

        # Direction

        if lead_line != 0:

            if lead_line == 1:
                corner_left, corner_right = footprint_bot_left, footprint_top_right
            else:
                corner_left, corner_right = footprint_top_left, footprint_bot_right

            # Create lines

            for band, txt_props in zip(SCALE_BANDS, self.text_props):

                band_matrix = Geometry.Matrix2D()
                band_matrix.SetScaling(band.factor, band.factor)

                target_list = model_ele_lists[band.name]

                if corner_left is not None and corner_right is not None:
                    near_left = Geometry.Move(left_start_pnt * band_matrix, vector_offset)
                    near_right = Geometry.Move(right_start_pnt * band_matrix, vector_offset)

                    target_list.append_geometry_2d(Geometry.Line2D(point1= corner_left, point2= near_left))
                    target_list.append_geometry_2d(Geometry.Line2D(point1= near_right, point2= corner_right))

        # ----
        # Placement matrix
        # ----

        placement_matrix = Geometry.Matrix3D()
        placement_matrix.SetTranslation(Geometry.Vector3D(gravity_pnt))

        # ----
        # Save parameters to the palette
        # ----

        self.build_ele.TimeStamp.value = time.time()
        self.build_ele.GravityPoint.value = gravity_pnt

        if not self.is_modification_mode:
            self.build_ele.InputPoint.value = gravity_pnt

        # ----
        # Create views
        # ----

        low_view_data = PythonPartViewData()
        low_view_data.start_scale = SCALE_BANDS.low.start_scale
        low_view_data.end_scale = SCALE_BANDS.low.end_scale

        mid_view_data = PythonPartViewData()
        mid_view_data.start_scale = SCALE_BANDS.mid.start_scale
        mid_view_data.end_scale = SCALE_BANDS.mid.end_scale

        high_view_data = PythonPartViewData()
        high_view_data.start_scale = SCALE_BANDS.high.start_scale
        high_view_data.end_scale = SCALE_BANDS.high.end_scale

        # ----
        # Association
        # ----

        slab_geo_str = repr(slab_adap.GetModelGeometry())
        center_slab_str = str(center_slab)
        attributes_str = repr(attributes)
        combined_string = slab_geo_str + center_slab_str + attributes_str
        self.build_ele.SourceElementHash.value = hashlib.sha224(combined_string.encode()).hexdigest()

        # ----
        # Create pythonpart
        # ----

        pyp_util = PythonPartUtil(common_props= com_prop)

        # Low model

        pyp_util.add_pythonpart_view_2d(
            elements= low_model_ele_list,
            view_data= low_view_data
            )

        # Mid model

        pyp_util.add_pythonpart_view_2d(
            elements= mid_model_ele_list,
            view_data= mid_view_data
            )

        # High model

        pyp_util.add_pythonpart_view_2d(
            elements= high_model_ele_list,
            view_data= high_view_data
            )

        pythonpart = pyp_util.create_pythonpart(
            build_ele= self.build_ele,
            placement_matrix= placement_matrix,
            type_display_name= DISPLAY_NAME
            )

        # ----
        # Check custom thickness
        # ----

        self.check_thickness_text(self.build_ele.CustomThickValue.value or "", bot_layer.height)

        # ----
        # PythonPart transaction
        # ----

        pyp_transaction = PythonPartTransaction(self.document)
        connect_to_elements = ConnectToElements(
            connection_elements=[str(slab_adap.GetModelElementUUID())])
        pyp_transaction.connect_to_ele = connect_to_elements

        pyp_transaction.execute(
            placement_matrix= Geometry.Matrix3D(),
            view_world_projection= self.coord_input.GetViewWorldProjection(),
            model_ele_list= pythonpart,
            modification_ele_list= self.modification_ele_list
            )


    def _format_altitude(self,
                         value_mm: float) -> str:
        """ Format altitude to text

        Args:
            value_mm: altitude in mm

        Returns:
            altitude as text
        """
        val = abs(value_mm) / 1000
        if value_mm == 0:
            return f"±{val:.2f}"
        sign = "+" if value_mm > 0 else "-"
        return f"{sign}{val:.2f}"


    def _build_text_properties(self) -> TextPropertiesByScale:
        """ Generates the TextProperties sets (struct/finish/thick) for each scale level

        Returns:
            TextPropertiesByScale with one ScaleTextProperties per band
        """
        base = BasisElements.TextProperties()
        base.Font = 21
        base.Alignment = BasisElements.TextAlignment.eMiddleMiddle
        base.IsScaleDependent = False

        struc_txt_base = 1.1
        finish_txt_base = 1
        thick_txt_base = 1.25

        def build_for(band: ScaleBand) -> ScaleTextProperties:
            """ Properties builder

            Args:
                band: scale level

            Returns:
                ScaleTextProperties
            """
            return ScaleTextProperties(
                struct= self._make_text_prop(base, struc_txt_base * band.factor, width_ratio= 0.9),
                finish= self._make_text_prop(base, finish_txt_base * band.factor, width_ratio= 0.9, font_angle_deg= 70),
                thick=  self._make_text_prop(base, thick_txt_base * band.factor)
                )

        return TextPropertiesByScale(
            low=  build_for(SCALE_BANDS.low),
            mid=  build_for(SCALE_BANDS.mid),
            high= build_for(SCALE_BANDS.high)
            )


    def check_thickness_text(self,
                             text: str,
                             actual_thickness: float,
                             tolerance: float = 1E-3) -> None:
        """ Check a thickness expressed in the same unit as the actual value.

        Args:
            text:             text representing the thickness, possibly as a sum of terms
            actual_thickness: actual thickness value to compare against
            tolerance:        allowable absolute difference between the sum and the actual thickness
        """
        if not THICKNESS_SUM.fullmatch(text):
            self.build_ele.ThickValidatePicture.value = 16613
            return None

        total = math.fsum(
            float(term.strip().replace(",", "."))
            for term in text.split("+")
            )

        check = math.isclose(
            total,
            actual_thickness,
            rel_tol= 0.0,
            abs_tol= tolerance
            )

        if check and self.build_ele.CustomThickValue.value:
            self.build_ele.ThickValidatePicture.value = 10427
        else:
            self.build_ele.ThickValidatePicture.value = 16613


    @staticmethod
    def _make_text_prop(base:           BasisElements.TextProperties,
                        height:         float,
                        width_ratio:    float = 1,
                        font_angle_deg: float | None = None) -> BasisElements.TextProperties:
        """ Construct a TextProperties from prototype

        Args:
            base:           text prototype
            height:         height of the text
            width_ratio:    ratio between height and width
            font_angle_deg: font angle in degrees (italic text)

        Returns:
            new text properties
        """
        prop = BasisElements.TextProperties(base)
        prop.Height = height
        prop.Width = height * width_ratio

        if font_angle_deg is not None:
            prop.FontAngle = Geometry.Angle.FromDeg(font_angle_deg)

        return prop
