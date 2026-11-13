import json
from pathlib import Path
from application.core.context import LaunchContext


class BaseApp:
    app_id = "base"
    title = "Application"
    script_name = ""
    canonical_url = ""

    def __init__(self, data_dir):
        self._data_dir = Path(data_dir)
        self._launch_context = LaunchContext()

    def _set_launch_context(self, context: LaunchContext) -> None:
        self._launch_context = LaunchContext(**vars(context))

    def _launch_plugin(self, plugin_id: str, plugin_options=None):
        from application.core.launching import launch_plugin
        return launch_plugin(plugin_id, self._launch_context, plugin_options)

    def get_app_info(self):
        return {"id": self.app_id, "title": self.title, "protocol_version": 1}

    def get_initial_data(self):
        # Fichier local fixe : le site ne choisit jamais un chemin arbitraire.
        path = self._data_dir / "initial_data.json"
        if not path.exists():
            return {"app": self.app_id, "data": {}}
        return {"app": self.app_id, "data": json.loads(path.read_text(encoding="utf-8"))}
