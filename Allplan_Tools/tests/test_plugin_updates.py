from copy import deepcopy
from threading import Event, Thread
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.core.plugin_updates import CatalogSession, Version, validate_document


DATE = "2026-11-10T15:00:00.000Z"


def release(version="1.3.0", *, minimum=None, maximum=None, lifecycle="ready",
            url="https://releases.example.test/tool/1.3.0", contract=1):
    return {
        "version": version, "releaseUrl": url, "lifecycle": lifecycle,
        "compatibility": {"homeContract": contract, "allplanMin": minimum, "allplanMax": maximum},
    }


def document(*releases):
    return {"schema": "allplan-tools-release-catalog/1", "plugins": [
        {"id": "tool", "name": "Remote name", "releases": list(releases)},
    ]}


class SemVerTests(unittest.TestCase):
    def test_empty_catalog_is_valid(self):
        self.assertEqual(validate_document({
            "schema": "allplan-tools-release-catalog/1", "plugins": [],
        }), {"schema": "allplan-tools-release-catalog/1", "plugins": []})

    def test_strict_semver_precedence(self):
        order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta",
                 "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11",
                 "1.0.0-rc.1", "1.0.0", "1.0.1", "2.0.0"]
        versions = [Version.parse(v) for v in order]
        self.assertEqual(sorted(reversed(versions)), versions)
        self.assertEqual(Version.parse("1.0.0+build.1"), Version.parse("1.0.0+other"))
        for invalid in ("v1.0.0", "01.0.0", "1.0", "1.0.0-01", " 1.0.0", "١.0.0", None):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                Version.parse(invalid)

    def test_document_rejects_ambiguous_or_invalid_releases(self):
        for value in (document(release("v1")), document(release(), release()),
                      document(release(minimum=2027, maximum=2026)),
                      document(release(contract=True)),
                      document(release("1.0.0+one"), release("1.0.0+two"))):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_document(value)
        value = document(release())
        value["plugins"].append(deepcopy(value["plugins"][0]))
        with self.assertRaises(ValueError):
            validate_document(value)


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.plugin = SimpleNamespace(id="tool", name="Local name", version="1.2.0", lifecycle="ready")
        self.installed = {"tool": self.plugin}
        self.loader = Mock(return_value=document(release()))
        self.opener = Mock(return_value=True)

    def session(self, **kwargs):
        options = dict(remote_loader=self.loader, allowed_hosts={"releases.example.test"},
                       open_link=self.opener, clock=lambda: DATE)
        options.update(kwargs)
        return CatalogSession(lambda: self.installed, "2026", **options)

    def test_default_is_unconfigured_without_network_or_open(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("network")), \
                patch("webbrowser.open", side_effect=AssertionError("browser")):
            session = CatalogSession(lambda: self.installed, "2026")
            data = session.get_catalog()["data"]
            self.assertEqual((data["status"], data["source"]), ("not_configured", "none"))
            self.assertIsNone(data["verifiedAt"])
            self.assertIsNone(data["lastAttemptAt"])
            self.assertEqual(data["entries"][0]["updateReason"], "catalog_not_configured")
            self.assertEqual(session.update("tool")["error"]["reason"], "catalog_not_configured")

    def test_empty_remote_and_unapproved_destinations_never_enable_update(self):
        for doc, reason in (
            ({"schema": "allplan-tools-release-catalog/1", "plugins": []}, "not_in_catalog"),
            (document(release()), "release_url_rejected"),
        ):
            loader = Mock(return_value=doc)
            session = CatalogSession(lambda: self.installed, "2026", remote_loader=loader)
            data = session.get_catalog()["data"]
            self.assertEqual((data["status"], data["source"]), ("available", "remote"))
            self.assertEqual(data["entries"][0]["updateReason"], reason)
            self.assertFalse(session.update("tool")["ok"])
            loader.side_effect = TimeoutError("budget expired")
            with self.assertLogs("application.core.plugin_updates", level="WARNING"):
                fallback = session.get_catalog()["data"]
            self.assertEqual((fallback["status"], fallback["source"]), ("unavailable", "cache"))
            self.assertEqual(fallback["verifiedAt"], data["verifiedAt"])
            self.assertFalse(fallback["entries"][0]["canUpdate"])

    def test_latest_all_and_latest_compatible_are_distinct(self):
        self.loader.return_value = document(release("3.0.0", minimum=2027),
                                            release("1.3.0"), release("1.1.0"))
        session = self.session()
        data = session.get_catalog()["data"]
        item = data["entries"][0]
        self.assertEqual((item["latestKnownVersion"], item["proposedVersion"]), ("3.0.0", "1.3.0"))
        self.assertEqual((item["comparison"], item["compatibility"]), ("newer", "compatible"))
        self.assertTrue(item["canUpdate"])
        self.assertEqual(item["name"], "Local name")
        self.loader.assert_called_once_with(timeout=3.0)
        self.assertEqual((data["verifiedAt"], data["lastAttemptAt"]), (DATE, DATE))
        self.assertTrue(session.update("tool")["ok"])
        self.opener.assert_called_once_with("https://releases.example.test/tool/1.3.0")
        self.loader.assert_called_once()

    def test_versions_unknown_invalid_equal_older(self):
        for installed, comparison, reason in [
            (None, "unknown", "installed_version_unknown"),
            ("legacy", "unknown", "installed_version_invalid"),
            ("1.3.0", "equal", "equal"), ("2.0.0", "older", "older"),
        ]:
            self.plugin.version = installed
            session = self.session()
            item = session.get_catalog()["data"]["entries"][0]
            self.assertEqual((item["comparison"], item["updateReason"]), (comparison, reason))
            self.assertFalse(session.update("tool")["ok"])
        self.opener.assert_not_called()

    def test_incompatible_unknown_empty_construction_and_missing_link(self):
        cases = [
            (document(release(minimum=2027)), "incompatible"),
            (document(release(contract=2)), "incompatible"),
            (document(), "no_releases"),
            (document(release(lifecycle="construction")), "construction"),
            (document(release(url=None)), "no_release_url"),
            (document(release(url="https://evil.example/tool")), "release_url_rejected"),
        ]
        for value, reason in cases:
            self.loader.return_value = value
            session = self.session()
            self.assertEqual(session.get_catalog()["data"]["entries"][0]["updateReason"], reason)
            self.assertFalse(session.update("tool")["ok"])
        self.loader.return_value = document(release(minimum=2022))
        session = CatalogSession(lambda: self.installed, "", remote_loader=self.loader)
        self.assertEqual(session.get_catalog()["data"]["entries"][0]["compatibility"], "unknown")
        self.plugin.lifecycle = "construction"
        self.assertEqual(self.session().get_catalog()["data"]["entries"][0]["updateReason"], "construction")
        self.opener.assert_not_called()

    def test_uninstalled_and_absent_from_catalog(self):
        self.installed["other"] = SimpleNamespace(name="Other", version=None, lifecycle="ready")
        del self.installed["tool"]
        session = self.session()
        items = {p["id"]: p for p in session.get_catalog()["data"]["entries"]}
        self.assertEqual(items["tool"]["updateReason"], "not_installed")
        self.assertIsNone(items["tool"]["installedLifecycle"])
        self.assertNotIn("launchable", items["tool"])
        self.assertEqual(items["other"]["updateReason"], "not_in_catalog")
        self.assertEqual(session.update("tool")["error"]["code"], "unknown_plugin")

    def test_cache_and_embedded_are_informative_not_network_errors(self):
        for source, date in (("cache", DATE), ("embedded", None)):
            session = self.session(remote_loader=None, fallback={
                "source": source, "document": document(release()), "verifiedAt": date,
            })
            data = session.get_catalog()["data"]
            self.assertEqual((data["status"], data["source"]), ("available", source))
            self.assertIsNone(data["error"])
            self.assertEqual(data["verifiedAt"], date)
            self.assertEqual(data["entries"][0]["updateReason"], "informative_source")
            self.assertFalse(session.update("tool")["ok"])
        self.opener.assert_not_called()

    def test_informative_catalog_reports_latest_without_enabling_equal_status(self):
        self.loader.return_value = document(release("4.0.0", lifecycle="construction"),
                                            release("1.3.0"))
        item = self.session().get_catalog()["data"]["entries"][0]
        self.assertEqual(item["latestKnownVersion"], "4.0.0")
        self.assertEqual(item["catalogLifecycle"], "construction")
        self.assertEqual(item["proposedVersion"], "1.3.0")
        self.assertTrue(item["canUpdate"])

    def test_invalid_cached_date_is_not_accepted(self):
        with self.assertLogs("application.core.plugin_updates", level="WARNING"):
            data = self.session(remote_loader=None, fallback={
                "source": "cache", "document": document(release()),
                "verifiedAt": "2026-99-10T15:00:00.000Z",
            }).get_catalog()["data"]
        self.assertEqual((data["status"], data["source"]), ("unavailable", "none"))
        self.assertIsNone(data["verifiedAt"])

    def test_failure_after_success_uses_cache_without_update_and_preserves_date(self):
        session = self.session()
        session.get_catalog()
        self.loader.side_effect = TimeoutError("simulated")
        with self.assertLogs("application.core.plugin_updates", level="WARNING"):
            data = session.get_catalog()["data"]
        self.assertEqual((data["status"], data["source"]), ("unavailable", "cache"))
        self.assertEqual(data["verifiedAt"], DATE)
        self.assertEqual(data["error"]["code"], "network_error")
        self.assertEqual(data["entries"][0]["updateReason"], "catalog_unavailable")
        self.assertFalse(session.update("tool")["ok"])
        self.opener.assert_not_called()

    def test_invalid_remote_or_cache_and_failure_without_fallback(self):
        for value, code in (({}, "invalid_catalog"), (OSError("simulated"), "network_error")):
            if isinstance(value, Exception):
                self.loader.side_effect = value
            else:
                self.loader.return_value = value
            with self.assertLogs("application.core.plugin_updates", level="WARNING"):
                data = self.session().get_catalog()["data"]
            self.assertEqual((data["status"], data["source"]), ("unavailable", "none"))
            self.assertEqual(data["error"]["code"], code)
        with self.assertLogs("application.core.plugin_updates", level="WARNING"):
            data = self.session(remote_loader=None, fallback={}).get_catalog()["data"]
        self.assertEqual(data["error"]["code"], "cache_error")

    def test_url_policy_rechecked_and_no_caller_url(self):
        for url in ("http://releases.example.test/x", "https://u@releases.example.test/x",
                    "https://releases.example.test:444/x", "https://releases.example.test/x#f",
                    "https://releases.example.test/ bad", "https://releases.example.test\\evil/x"):
            self.loader.return_value = document(release(url=url))
            self.assertFalse(self.session().get_catalog()["data"]["entries"][0]["canUpdate"])
        session = self.session()
        with self.assertRaises(TypeError):
            session.update("tool", "https://evil.example")
        self.assertEqual(session.update([])["error"]["code"], "invalid_arguments")

    def test_changed_installation_or_policy_and_opener_failure(self):
        for field, value in (("version", "1.1.0"), ("lifecycle", "construction")):
            session = self.session()
            session.get_catalog()
            old = getattr(self.plugin, field)
            setattr(self.plugin, field, value)
            self.assertEqual(session.update("tool")["error"]["code"], "catalog_changed")
            setattr(self.plugin, field, old)
        session = self.session()
        session.get_catalog()
        session._hosts = frozenset()
        self.assertEqual(session.update("tool")["error"]["code"], "catalog_changed")
        self.opener.assert_not_called()
        for failure in (False, OSError("simulated")):
            self.opener.side_effect = failure if isinstance(failure, Exception) else None
            self.opener.return_value = failure
            session = self.session()
            session.get_catalog()
            if isinstance(failure, Exception):
                with self.assertLogs("application.core.plugin_updates", level="ERROR"):
                    result = session.update("tool")
            else:
                result = session.update("tool")
            self.assertEqual(result["error"]["code"], "link_open_failed")

    def test_sessions_are_isolated_and_request_does_not_open_or_refresh(self):
        first, second = self.session(), self.session()
        first.get_catalog()
        self.assertFalse(second.update("tool")["ok"])
        self.assertTrue(first.update("tool")["ok"])
        self.assertEqual(self.loader.call_count, 1)

    def test_late_response_cannot_restore_an_old_proposal_or_cache(self):
        entered, finish = Event(), Event()
        def load(*, timeout):
            if not entered.is_set():
                entered.set()
                if not finish.wait(3):
                    raise TimeoutError("test synchronization")
                return document(release("9.0.0"))
            return document(release("2.0.0", url="https://releases.example.test/tool/2.0.0"))
        session = self.session(remote_loader=load)
        replies = []
        thread = Thread(target=lambda: replies.append(session.get_catalog()))
        thread.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertFalse(session.update("tool")["ok"])
            latest = session.get_catalog()["data"]
            self.assertEqual(latest["requestId"], 2)
        finally:
            finish.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertTrue(replies[0]["data"]["superseded"])
        self.assertFalse(replies[0]["data"]["entries"][0]["canUpdate"])
        self.assertEqual(session.update("tool")["data"]["version"], "2.0.0")
        self.opener.assert_called_once_with("https://releases.example.test/tool/2.0.0")


if __name__ == "__main__":
    unittest.main()
