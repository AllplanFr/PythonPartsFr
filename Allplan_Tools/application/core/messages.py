"""Shared messages and errors; plugin translations stay in plugin resources."""
import json

from .catalog import PLUGINS
from .resources import PACKAGE_ROOT, resource_path


LANGUAGE_PATHS = (("lang",),) + tuple(
    tuple(path.split("."))
    for plugin in PLUGINS.values() for path in plugin.language_paths
) + (("app", "lang"), ("general", "lang"))
MESSAGES = json.loads(resource_path(
    PACKAGE_ROOT / "core", "resources\\messages.json",
).read_text(encoding="utf-8"))


def settings_language(settings):
    for path in LANGUAGE_PATHS:
        value = settings
        for key in path:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def tr(code, lang="en", *, _translations=None, **params):
    translations = (MESSAGES if _translations is None else _translations)[code]
    language = lang.lower().replace("_", "-").split("-")[0]
    return translations.get(language, translations["en"]).format(**params)


class MessageError(ValueError):
    translations = MESSAGES

    def __init__(self, key, **params):
        self.key = key
        self.params = params
        super().__init__(tr(key, _translations=self.translations, **params))
