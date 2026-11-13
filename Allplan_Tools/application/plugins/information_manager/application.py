from application.core.base import BaseApp
from application.core.catalog import PLUGINS
import json
import logging


class InformationManagerApp(BaseApp):
    app_id = "information_manager"
    title = PLUGINS[app_id].name
    canonical_url = PLUGINS[app_id].url
    script_name = PLUGINS[app_id].script

    def get_initial_data(self):
        try:
            text = (self._data_dir / "initial_data.json").read_text(encoding="utf-8")
        except FileNotFoundError:
            return {"app": self.app_id, "data": {}}
        data = json.loads(text)
        if (not isinstance(data, dict) or not isinstance(data.get("catalog"), list)
                or ("attributes" in data and not isinstance(data["attributes"], list))
                or ("values" in data and not isinstance(data["values"], dict))):
            logging.getLogger(__name__).error("AIM initial data incompatible with limited host.")
            raise ValueError("AIM initial data incompatible: catalog array required; "
                             "attributes must be an array and values an object when provided.")
        return {"app": self.app_id, "data": data}
