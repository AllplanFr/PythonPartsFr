from .entry import check_allplan_version, create_element, control_event, create_launcher


def create_script_object(build_ele, script_object_data):
    return create_launcher("information_manager", build_ele, script_object_data)


def on_control_event(build_ele, event_id, doc):
    return control_event("information_manager", build_ele, event_id, doc)
