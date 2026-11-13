from .entry import check_allplan_version, create_element, control_event, create_launcher


PLUGIN_ID = "replace_with_registered_plugin_id"


def create_script_object(build_ele, script_object_data):
    return create_launcher(PLUGIN_ID, build_ele, script_object_data)


def on_control_event(build_ele, event_id, doc):
    return control_event(PLUGIN_ID, build_ele, event_id, doc)
