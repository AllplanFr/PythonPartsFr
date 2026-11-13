"""Fail-closed preparation for the separately requested SmartCatalog RC1 window."""
from dataclasses import dataclass
from urllib.parse import urlsplit


_REVIEWED_RECIPE_EVIDENCE = None


class RemoteRecipeNotReady(RuntimeError):
    """The remote page has not supplied independently reviewed release evidence."""


def _https_url(value):
    if (not isinstance(value, str) or not value or value != value.strip()
            or any(ord(char) <= 32 for char in value) or "\\" in value or "*" in value):
        return False
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
            and not parsed.fragment
        )
    except ValueError:
        return False


@dataclass(frozen=True)
class RemoteRecipePolicy:
    """Exact URLs for a reviewed recipe build; no origin or wildcard matching."""

    document_url: str
    resource_urls: frozenset[str]

    def __post_init__(self):
        if not _https_url(self.document_url):
            raise ValueError("Recipe document must be an exact HTTPS URL.")
        if type(self.resource_urls) is not frozenset or not self.resource_urls or any(
            not _https_url(url) or url == self.document_url
            for url in self.resource_urls
        ):
            raise ValueError("Recipe resources must be exact HTTPS subresource URLs.")

    def allows_navigation(
        self, url, *, is_redirect=False, is_top_level=True, is_popup=False,
        is_auth_flow=False,
    ):
        return (
            url == self.document_url
            and not is_redirect
            and is_top_level
            and not is_popup
            and not is_auth_flow
        )

    def allows_resource(
        self, url, *, method, source_url, resource_kind="subresource",
        is_redirect=False, is_auth_flow=False,
    ):
        return (
            method == "GET"
            and source_url == self.document_url
            and resource_kind == "subresource"
            and not is_redirect
            and not is_auth_flow
            and url in self.resource_urls
        )


def require_reviewed_recipe():
    """Never accept a URL or allowlist from CLI/environment configuration."""
    if _REVIEWED_RECIPE_EVIDENCE is None:
        raise RemoteRecipeNotReady(
            "Essai distant SmartCatalog non execute : aucun retour frontend "
            "verifie (URL/route activee, build, empreintes, destinations reseau "
            "et comportement de demarrage) n'a ete fourni. Aucun navigateur "
            "distant n'a ete lance."
        )
    raise RemoteRecipeNotReady(
        "Essai distant SmartCatalog non execute : les preuves frontend seules "
        "ne constituent pas une autorisation ni un adaptateur distant valide."
    )
