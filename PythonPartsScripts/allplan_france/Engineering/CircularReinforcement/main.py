# -*- coding: utf-8 -*-
""" CircularReinforcement using ScriptObject PythonPart

Copyright © 2026 ALLPLAN FRANCE - Christophe MAIGNAN
"""
from __future__ import annotations

from typing import cast

import NemAll_Python_BaseElements    as BaseElements
import NemAll_Python_Geometry        as Geometry
import NemAll_Python_AllplanSettings as Settings
import NemAll_Python_Reinforcement   as Reinforcement

from BuildingElement              import BuildingElement
from CreateElementResult          import CreateElementResult
from HandleProperties             import HandleProperties
from PythonPartUtil               import PythonPartUtil
from BuildingElementAttributeList import BuildingElementAttributeList

from BaseScriptObject import BaseScriptObject
from BaseScriptObject import BaseScriptObjectData

from TypeCollections.HandleList   import HandleList
from TypeCollections.ModelEleList import ModelEleList

from Utils.HandleCreator                import HandleCreator
from Utils.Geometry.TransformationStack import TransformationStack

from StdReinfShapeBuilder                              import LinearBarPlacementBuilder
from StdReinfShapeBuilder.ReinforcementShapeProperties import ReinforcementShapeProperties
from StdReinfShapeBuilder.BarShapeSideDataList         import BarShapeSideDataList


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

        self.trans_stack = TransformationStack()

        self.com_prop = BaseElements.CommonProperties()
        self.reinf_prop = BaseElements.CommonProperties()


    def start_input(self) -> None:
        """ First input
        """
        self.script_object_interactor = None


    def execute(self) -> CreateElementResult:
        """ Execute the script

        Returns:
            created element result
        """
        # ----
        # Get parameters from the palette
        # ----

        zone_name = self.build_ele.ZoneName.value

        center_point = Geometry.Point2D()
        inner_radius = self.build_ele.InnerRadius.value
        outer_radius = self.build_ele.OuterRadius.value
        rotation = self.build_ele.Rotation.value
        bottom_plane = self.build_ele.BottomPlane.value
        z_offset = bottom_plane.GetAbsBottomElevation()

        concrete_cover = self.build_ele.ReinfConcreteCover.value
        circ_rebar_diam = self.build_ele.CircularBarDiameter.value
        circ_rebar_length = self.build_ele.CircularBarLength.value
        circ_rebar_spacing = self.build_ele.CircularBarSpacing.value

        form_choice = self.build_ele.FormRadioGroup.value
        distribution_direction = self.build_ele.DistributionDirection.value

        has_distribution = self.build_ele.DistributionCheckBox.value
        distrib_type = self.build_ele.DistribTypeRadioGroup.value
        distrib_count = self.build_ele.DistribCount.value
        distrib_spacing = self.build_ele.DistribSpacing.value
        distrib_height = self.build_ele.DistribHeight.value

        self.com_prop = self.build_ele.CommonProp.value
        self.reinf_prop = self.build_ele.ReinfProp.value

        # ----
        # Transformation stack
        # ----

        self.trans_stack = TransformationStack()
        self.trans_stack.rotate_z(rotation)

        # ----
        # Geometry
        # ----

        model_ele_list = ModelEleList(com_prop= self.com_prop, trans_stack= self.trans_stack)

        outer_circle = Geometry.Arc2D(center_point, outer_radius)
        inner_circle = Geometry.Arc2D(center_point, inner_radius)
        ref_line = Geometry.Line2D(center_point, Geometry.Point2D(outer_radius, 0))

        for geo in (
            outer_circle,
            inner_circle,
            ref_line,
            ):
            model_ele_list.append_geometry_2d(geo)

        # ----
        # Reinforcement helpers
        # ----

        arc_list = []
        start_radius = inner_radius + concrete_cover
        end_radius = outer_radius - concrete_cover

        radii = self.build_radii(
            radius_min= start_radius,
            radius_max= end_radius,
            spacing_expr= circ_rebar_spacing,
            direction= distribution_direction
            )

        # Form A
        if form_choice == 'A':

            for radius in radii:
                end_angle = self.get_end_angle(radius, circ_rebar_length)

                arc = Geometry.Arc2D(
                    center= center_point,
                    major= radius,
                    minor= radius,
                    axisangle= 0,
                    startangle= 0,
                    endangle= float(end_angle),
                    counterClockwise= True
                    )
                arc_list.append(arc)

        # Form B
        else:

            end_angle = self.get_end_angle(end_radius, circ_rebar_length)

            for radius in radii:
                arc = Geometry.Arc2D(
                    center= center_point,
                    major= radius,
                    minor= radius,
                    axisangle= 0,
                    startangle= 0,
                    endangle= float(end_angle),
                    counterClockwise= True
                    )
                arc_list.append(arc)

        # ----
        # Reinforcement
        # ----

        reinforcement = []

        shape_properties = ReinforcementShapeProperties.rebar(
            diameter= circ_rebar_diam,
            bending_roller= 4,
            steel_grade= -1,
            concrete_grade= -1,
            bending_shape_type= Reinforcement.BendingShapeType.BarWithArc
            )

        for idx, arc in enumerate(arc_list):

            arc = Geometry.Rotate(arc, Geometry.Point2D(), Geometry.Angle.FromDeg(rotation))

            shape_data = BarShapeSideDataList([0, (arc, 0), 0])

            shape_builder = Reinforcement.ReinforcementShapeBuilder()
            shape_builder.AddSides(shape_data)

            shape = shape_builder.CreateShape(shape_properties)
            shape.Move(Geometry.Vector3D(0, 0, z_offset))

            if has_distribution:
                if distrib_type == 0:
                    placement = LinearBarPlacementBuilder.create_linear_bar_placement_from_to_by_count(
                        position= idx + 1,
                        shape= shape,
                        from_point= Geometry.Point3D(),
                        to_point= Geometry.Point3D(0, 0, distrib_height),
                        concrete_cover_left= concrete_cover,
                        concrete_cover_right= concrete_cover,
                        bar_count= distrib_count
                        )
                else:
                    placement = LinearBarPlacementBuilder.create_linear_bar_placement_from_to_by_dist(
                        position= idx + 1,
                        shape= shape,
                        from_point= Geometry.Point3D(),
                        to_point= Geometry.Point3D(0, 0, distrib_height),
                        concrete_cover_left= concrete_cover,
                        concrete_cover_right= concrete_cover,
                        bar_distance= distrib_spacing
                        )

            else:
                placement = Reinforcement.BarPlacement(
                    positionNumber= idx + 1,
                    barCount= 1,
                    distVec= Geometry.Vector3D(),
                    startPnt= Geometry.Point3D(),
                    endPnt= Geometry.Point3D(),
                    bendingShape= shape
                    )

            placement.SetCommonProperties(self.reinf_prop)
            reinforcement.append(placement)

        # ----
        # Attributes
        # ----

        attr_list = BuildingElementAttributeList()
        attr_list.add_attribute(507, zone_name)

        # ----
        # Create PythonPart
        # ----

        pyp_util = PythonPartUtil(common_props= self.com_prop)
        pyp_util.add_pythonpart_view_2d(model_ele_list)
        pyp_util.add_reinforcement_elements(reinforcement)
        pyp_util.add_attribute_list(attr_list)
        pythonpart = pyp_util.create_pythonpart(
                build_ele= self.build_ele,
                type_display_name= "PyCircularRebar"
                )
        return CreateElementResult(
            elements= pythonpart,
            handles= self.create_handles()
            )


    def create_handles(self) -> list[HandleProperties]:
        """ Create the handles

        Returns:
            handles
        """
        handle_list = HandleList(trans_stack= self.trans_stack)

        HandleCreator.x_distance(
            handle_list= handle_list,
            name= "InnerRadius",
            handle_point= Geometry.Point3D(self.build_ele.InnerRadius.value, 0, 0),
            ref_point= Geometry.Point3D()
            )

        HandleCreator.x_distance(
            handle_list= handle_list,
            name= "OuterRadius",
            handle_point= Geometry.Point3D(self.build_ele.OuterRadius.value, 0, 0),
            ref_point= Geometry.Point3D()
            )

        return handle_list


    def parse_spacing_expression(self,
                                 expr: str) -> list[float]:
        """ Transform an expression like: '250 ; 3*200 ; 175'
        into: [250.0, 200.0, 200.0, 200.0, 175.0]

        Args:
            expr: expression to parse

        Returns:
            list of spacing values

        Raises:
            ValueError: if the expression is invalid
        """
        result: list[float] = []

        for token in expr.split(";"):
            token = token.strip().replace(" ", "").replace(",", ".")

            if not token:
                continue

            if "*" in token:
                parts = token.split("*")
                if len(parts) != 2:
                    raise ValueError(f"Invalid spacing token: '{token}'")

                repeat_count = int(parts[0])
                spacing_value = float(parts[1])

                if repeat_count <= 0:
                    raise ValueError(f"Invalid repetition count: '{token}'")

                for _ in range(repeat_count):
                    result.append(spacing_value)
            else:
                result.append(float(token))

        if not result:
            raise ValueError("The spacing expression is empty.")

        return result


    def build_radii(self,
                    radius_min:   float,
                    radius_max:   float,
                    spacing_expr: str,
                    direction:    bool) -> list[float]:
        """ Build the list of radii according to the spacing rule.

        If the spacing expression contains a single value, that spacing is
        repeated until the maximum radius is reached. If the spacing
        expression contains multiple values, the sequence is applied once
        and the construction stops as soon as the next radius would exceed
        the maximum radius.

        Args:
            radius_min:   starting radius
            radius_max:   maximum allowed radius
            spacing_expr: text expression describing the spacing pattern
            direction:    0 => "inside to outside" | 1 => "outside to inside"

        Returns:
            list of radii generated from the spacing pattern

        Raises:
            ValueError: if the spacing expression cannot be parsed
        """
        spacings = self.parse_spacing_expression(spacing_expr)

        # Inside to outside
        if not direction:

            radii = [radius_min]
            current_radius = radius_min

            if len(spacings) == 1:
                spacing = spacings[0]

                if spacing <= 0:
                    raise ValueError("The spacing value must be greater than zero.")

                while True:
                    next_radius = current_radius + spacing
                    if next_radius > radius_max:
                        break

                    radii.append(next_radius)
                    current_radius = next_radius

            else:
                for spacing in spacings:
                    if spacing <= 0:
                        raise ValueError("Each spacing value must be greater than zero.")

                    next_radius = current_radius + spacing
                    if next_radius > radius_max:
                        break

                    radii.append(next_radius)
                    current_radius = next_radius

        # Outside to inside
        else:

            radii = [radius_max]
            current_radius = radius_max

            if len(spacings) == 1:
                spacing = spacings[0]

                if spacing <= 0:
                    raise ValueError("The spacing value must be greater than zero.")

                while True:
                    next_radius = current_radius - spacing
                    if next_radius < radius_min:
                        break

                    radii.append(next_radius)
                    current_radius = next_radius

            else:
                for spacing in spacings:
                    if spacing <= 0:
                        raise ValueError("Each spacing value must be greater than zero.")

                    next_radius = current_radius - spacing
                    if next_radius < radius_min:
                        break

                    radii.append(next_radius)
                    current_radius = next_radius

        return radii


    def get_end_angle(self,
                      radius:     float,
                      arc_length: float) -> Geometry.Angle:
        """ Calculate the end angle from a radius and an arc length.

        The returned value is an Allplan ``Angle`` object expressed in
        radians internally. It can be passed directly to Allplan geometry
        workflows or converted with ``float(...)`` when needed.

        Args:
            radius:     arc radius
            arc_length: target arc length

        Returns:
            end angle as an Allplan ``Angle`` object

        Raises:
            ValueError: if the radius is less than or equal to zero
        """
        if radius <= 0:
            raise ValueError("The radius must be greater than zero.")

        return Geometry.Angle(arc_length / radius)
