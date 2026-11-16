"""Optional release catalog; no configured network endpoint or browser action."""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import total_ordering
import logging
import re
from threading import Lock
from urllib.parse import urlsplit


LOGGER = logging.getLogger(__name__)
REMOTE_TIMEOUT_SECONDS = 3.0
ID = re.compile(r"[a-z][a-z0-9_]*")
SEMVER = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?", re.ASCII,
)


@total_ordering
@dataclass(frozen=True, eq=False)
class Version:
    core: tuple[int, int, int]
    prerelease: tuple[str, ...]

    @classmethod
    def parse(cls, raw):
        match = SEMVER.fullmatch(raw) if isinstance(raw, str) else None
        if match is None:
            raise ValueError("Version SemVer invalide.")
        pre = tuple(match[4].split(".")) if match[4] else ()
        if any(part.isdigit() and len(part) > 1 and part.startswith("0") for part in pre):
            raise ValueError("Identifiant numerique SemVer invalide.")
        return cls(tuple(int(match[n]) for n in (1, 2, 3)), pre)

    def __eq__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        return (self.core, self.prerelease) == (other.core, other.prerelease)

    def __lt__(self, other):
        if not isinstance(other, Version):
            return NotImplemented
        if self.core != other.core:
            return self.core < other.core
        if not self.prerelease or not other.prerelease:
            return bool(self.prerelease) and not other.prerelease
        for left, right in zip(self.prerelease, other.prerelease):
            if left == right:
                continue
            if left.isdigit() and right.isdigit():
                return int(left) < int(right)
            if left.isdigit() != right.isdigit():
                return left.isdigit()
            return left < right
        return len(self.prerelease) < len(other.prerelease)


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_document(document):
    """Strict JSON shape, unique plugin identities and unambiguous precedence."""
    if (type(document) is not dict or set(document) != {"schema", "plugins"}
            or document["schema"] != "allplan-tools-release-catalog/1"
            or type(document["plugins"]) is not list):
        raise ValueError("Structure du catalogue invalide.")
    ids = set()
    for plugin in document["plugins"]:
        if (type(plugin) is not dict or set(plugin) != {"id", "name", "releases"}
                or not isinstance(plugin["id"], str) or not ID.fullmatch(plugin["id"])
                or plugin["id"] in ids or not _text(plugin["name"])
                or type(plugin["releases"]) is not list):
            raise ValueError("Declaration de plugin distante invalide.")
        ids.add(plugin["id"])
        versions = []
        for release in plugin["releases"]:
            if (type(release) is not dict
                    or set(release) != {"version", "releaseUrl", "lifecycle", "compatibility"}
                    or release["lifecycle"] not in ("ready", "construction")
                    or not (release["releaseUrl"] is None or _text(release["releaseUrl"]))):
                raise ValueError("Declaration de release invalide.")
            version = Version.parse(release["version"])
            if version in versions:
                raise ValueError("Releases de meme precedence SemVer interdites.")
            versions.append(version)
            compatibility = release["compatibility"]
            if (type(compatibility) is not dict
                    or set(compatibility) != {"homeContract", "allplanMin", "allplanMax"}
                    or type(compatibility["homeContract"]) is not int
                    or compatibility["homeContract"] < 1
                    or any(v is not None and (type(v) is not int or v < 1)
                           for v in (compatibility["allplanMin"], compatibility["allplanMax"]))):
                raise ValueError("Compatibilite invalide.")
            low, high = compatibility["allplanMin"], compatibility["allplanMax"]
            if low is not None and high is not None and low > high:
                raise ValueError("Bornes Allplan inversees.")
    return deepcopy(document)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CatalogSession:
    """One instance per HomeApi/window; remote loader and opener are disabled by default.

    A future approved loader must enforce the supplied total timeout and access policy.
    No loader, endpoint, persistent cache or real opener is enabled by this module.
    """

    def __init__(self, installed, year, *, remote_loader=None, fallback=None,
                 allowed_hosts=(), open_link=None, clock=_now):
        self._installed = installed
        self._year = year
        self._loader = remote_loader
        self._fallback = deepcopy(fallback)
        self._hosts = frozenset(allowed_hosts)
        self._open = open_link
        self._clock = clock
        self._lock = Lock()
        self._sequence = 0
        self._proposals = {}
        self._reasons = {}
        self._default_reason = "catalog_not_configured" if remote_loader is None and fallback is None else "catalog_pending"

    def _link_allowed(self, url):
        if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url):
            return False
        try:
            parsed = urlsplit(url)
            return (parsed.scheme == "https" and parsed.hostname in self._hosts
                    and parsed.username is None and parsed.password is None
                    and parsed.port in (None, 443) and not parsed.fragment
                    and "\\" not in url)
        except ValueError:
            return False

    def _compatibility(self, release):
        bounds = release["compatibility"]
        if bounds["homeContract"] != 1:
            return "incompatible"
        low, high = bounds["allplanMin"], bounds["allplanMax"]
        if low is None and high is None:
            return "compatible"
        if not self._year or not self._year.isdecimal():
            return "unknown"
        year = int(self._year)
        return "compatible" if ((low is None or year >= low)
                                and (high is None or year <= high)) else "incompatible"

    def _project(self, document, installed, gate):
        remote = {p["id"]: p for p in document["plugins"]} if document else {}
        entries, proposals = [], {}
        for identity in sorted(set(installed) | set(remote)):
            local = installed.get(identity)
            plugin = remote.get(identity)
            releases = sorted(plugin["releases"], key=lambda r: Version.parse(r["version"]),
                              reverse=True) if plugin else []
            compatible = [r for r in releases if self._compatibility(r) == "compatible"]
            ready = [r for r in compatible if r["lifecycle"] == "ready"]
            proposed = ready[0] if ready else None
            version = local.version if local else None
            comparison = "unknown"
            invalid = False
            if version is not None:
                try:
                    installed_version = Version.parse(version)
                except ValueError:
                    invalid = True
                else:
                    if proposed:
                        candidate = Version.parse(proposed["version"])
                        comparison = ("newer" if candidate > installed_version else
                                      "older" if candidate < installed_version else "equal")
            compatibility = ("compatible" if proposed else
                             "unknown" if not releases or any(
                                 self._compatibility(r) == "unknown" for r in releases)
                             else "incompatible" if not compatible else "compatible")
            reason = gate
            if reason is None:
                if local is None:
                    reason = "not_installed"
                elif plugin is None:
                    reason = "not_in_catalog"
                elif local.lifecycle == "construction" or (compatible and not ready):
                    reason = "construction"
                elif version is None:
                    reason = "installed_version_unknown"
                elif invalid:
                    reason = "installed_version_invalid"
                elif not releases:
                    reason = "no_releases"
                elif compatibility == "unknown":
                    reason = "compatibility_unknown"
                elif compatibility == "incompatible":
                    reason = "incompatible"
                elif comparison != "newer":
                    reason = comparison
                elif proposed["releaseUrl"] is None:
                    reason = "no_release_url"
                elif not self._link_allowed(proposed["releaseUrl"]):
                    reason = "release_url_rejected"
            entry = {
                "id": identity, "name": local.name if local else plugin["name"],
                "installed": local is not None, "installedVersion": version,
                "installedLifecycle": local.lifecycle if local else None,
                "inCatalog": plugin is not None,
                "latestKnownVersion": releases[0]["version"] if releases else None,
                "proposedVersion": proposed["version"] if proposed else None,
                "catalogLifecycle": releases[0]["lifecycle"] if releases else None,
                "comparison": comparison, "compatibility": compatibility,
                "canUpdate": reason is None, "updateReason": reason,
            }
            entries.append(entry)
            if reason is None:
                proposals[identity] = {
                    "version": proposed["version"], "url": proposed["releaseUrl"],
                    "installedVersion": version, "installedLifecycle": local.lifecycle,
                    "compatibility": deepcopy(proposed["compatibility"]),
                }
        return entries, proposals

    def get_catalog(self):
        with self._lock:
            self._sequence += 1
            sequence = self._sequence
            self._proposals = {}
            self._reasons = {}
            self._default_reason = "catalog_pending"
            fallback = deepcopy(self._fallback)
        status, source, document, verified, attempted, error = (
            "not_configured", "none", None, None, None, None,
        )
        if fallback is not None:
            try:
                if (set(fallback) != {"source", "document", "verifiedAt"}
                        or fallback["source"] not in ("embedded", "cache")
                        or (fallback["source"] == "embedded" and fallback["verifiedAt"] is not None)
                        or (fallback["source"] == "cache" and (
                            not isinstance(fallback["verifiedAt"], str)
                            or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",
                                                fallback["verifiedAt"])))):
                    raise ValueError("Metadonnees de catalogue local invalides.")
                document = validate_document(fallback["document"])
                source, verified, status = fallback["source"], fallback["verifiedAt"], "available"
            except (ValueError, TypeError, KeyError) as exc:
                LOGGER.warning("Catalogue local invalide : %s", exc)
                status = "unavailable"
                error = {"code": "cache_error", "message": str(exc)}
            else:
                if verified is not None:
                    try:
                        datetime.strptime(verified, "%Y-%m-%dT%H:%M:%S.%fZ")
                    except ValueError:
                        LOGGER.warning("Date de verification du cache invalide")
                        document, source, verified, status = None, "none", None, "unavailable"
                        error = {"code": "cache_error", "message": "Date de verification invalide."}
        if self._loader is not None:
            attempted = self._clock()
            try:
                document_remote = self._loader(timeout=REMOTE_TIMEOUT_SECONDS)
                validated = validate_document(document_remote)
            except OSError as exc:
                LOGGER.warning("Catalogue distant indisponible : %s", type(exc).__name__)
                status = "unavailable"
                error = {"code": "network_error", "message": "Consultation distante impossible."}
            except (ValueError, TypeError, KeyError) as exc:
                LOGGER.warning("Catalogue distant invalide : %s", exc)
                status = "unavailable"
                error = {"code": "invalid_catalog", "message": "Catalogue distant invalide."}
            else:
                document, source, status, verified, error = (
                    validated, "remote", "available", self._clock(), None,
                )
        gate = ("catalog_not_configured" if status == "not_configured" else
                "catalog_unavailable" if status == "unavailable" else
                "informative_source" if source != "remote" else None)
        installed = self._installed()
        entries, proposals = self._project(document, installed, gate)
        with self._lock:
            superseded = sequence != self._sequence
            if superseded:
                for entry in entries:
                    entry.update(canUpdate=False, updateReason="catalog_superseded")
            else:
                self._proposals = proposals
                self._reasons = {entry["id"]: entry["updateReason"] for entry in entries}
                self._default_reason = gate
                if source == "remote" and status == "available":
                    self._fallback = {
                        "source": "cache", "document": document, "verifiedAt": verified,
                    }
        return {"ok": True, "data": {
            "schema": "allplan-tools-catalog/2", "requestId": sequence,
            "superseded": superseded, "status": status, "source": source,
            "verifiedAt": verified, "lastAttemptAt": attempted,
            "entries": entries, "error": error,
        }}

    @staticmethod
    def _failure(code, message, reason=None):
        return {"ok": False, "error": {"code": code, "message": message, "reason": reason}}

    def update(self, identity):
        if type(identity) is not str:
            return self._failure("invalid_arguments", "Identifiant textuel requis.")
        with self._lock:
            installed = self._installed()
            if identity not in installed:
                return self._failure("unknown_plugin", "Plugin local inconnu.", "not_installed")
            proposal = self._proposals.get(identity)
            if proposal is None:
                return self._failure("update_not_available", "Aucune proposition active.",
                                     self._reasons.get(identity, self._default_reason))
            local = installed[identity]
            release = {"compatibility": proposal["compatibility"]}
            if (local.version != proposal["installedVersion"]
                    or local.lifecycle != proposal["installedLifecycle"]
                    or local.lifecycle != "ready"
                    or self._compatibility(release) != "compatible"
                    or not Version.parse(local.version) < Version.parse(proposal["version"])
                    or not self._link_allowed(proposal["url"])):
                self._proposals.pop(identity, None)
                return self._failure("catalog_changed", "Proposition devenue invalide.")
            try:
                opened = self._open is not None and self._open(proposal["url"]) is True
            except OSError:
                LOGGER.exception("Ouverture du lien de release impossible")
                opened = False
            if not opened:
                return self._failure("link_open_failed", "Demande d'ouverture impossible.")
            return {"ok": True, "data": {
                "id": identity, "version": proposal["version"], "status": "link_open_requested",
            }}
