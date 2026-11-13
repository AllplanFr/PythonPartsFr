"""VOB messages extend, but never modify, the shared translations."""
import json
from pathlib import Path

from application.core.messages import MESSAGES as COMMON_MESSAGES
from application.core.messages import MessageError as CommonMessageError
from application.core.messages import tr as translate
from application.core.resources import resource_path


MESSAGES = {
    **COMMON_MESSAGES,
    **json.loads(resource_path(
        Path(__file__).resolve().parent, "resources\\messages.json",
    ).read_text(encoding="utf-8")),
}


def tr(code, lang="en", **params):
    return translate(code, lang, _translations=MESSAGES, **params)


class MessageError(CommonMessageError):
    translations = MESSAGES
