"""Script"""

from CreateElementResult import CreateElementResult

from BuildingElement import BuildingElement

from BaseScriptObject import BaseScriptObject, BaseScriptObjectData


class MyScriptObject(BaseScriptObject):
    """ Implementation of the script object class"""

    def __init__(self, build_ele: BuildingElement, script_object_data: BaseScriptObjectData) -> None:
        """ Initialization Aim Element

        Args:
            build_ele (BuildingElement): building element with the parameter properties
            script_object_data (BaseScriptObjectData): script object data

        Returns:
            None
        """

        super().__init__(script_object_data)

        self.build_ele = build_ele

        self.script_object_data = script_object_data

    def start_input(self) -> None:
        """ First input

        Returns:
            None
        """
        self.script_object_interactor = None

        return None

    def execute(self) -> CreateElementResult:
        """ Execute the script

        Returns:
            created element result
        """

        return CreateElementResult()

    def on_control_event(self, event_id: int) -> bool:
        """ Handle the control event

        Args:
            event_id (int): event ID

        Returns:
            event was processed state
        """

        print(event_id)

        return True

    def modify_element_property(self,
                                name: str,
                                value: int) -> bool:
        """ Modify the element property

        Args:
            name:   name
            value: value

        Returns:
            update palette state
        """

        if isinstance(value, int):
            self.build_ele.Code.value = value

        return True
