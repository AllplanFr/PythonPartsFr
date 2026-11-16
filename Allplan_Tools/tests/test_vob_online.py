import hashlib
import json
import unittest

from application.launcher import vob_online


class VobOnlineTests(unittest.TestCase):
    def setUp(self):
        self.javascript = (
            b'const app="vob_editor";const commands=["vob.open","vob.save",'
            b'"vob.backups.restore"];'
        )
        self.stylesheet = b"body{color:#000}"
        self.manifest = {
            "schema": "build-identity/1",
            "vobEditorCompatibility": vob_online.COMPATIBILITY,
            "revision": "a" * 40,
            "revisionStatus": "git-rev-parse-HEAD",
            "trackedChangesAtBuild": False,
            "builtAt": "2026-11-06T00:00:00.000Z",
            "files": [
                {"file": "/assets/app.js", "kind": "entry",
                 "sha256": hashlib.sha256(self.javascript).hexdigest()},
                {"file": "/assets/app.css", "kind": "asset",
                 "sha256": hashlib.sha256(self.stylesheet).hexdigest()},
            ],
        }
        self.responses = {
            vob_online.ORIGIN + "/build-manifest.json":
                json.dumps(self.manifest).encode("utf-8"),
            vob_online.ROUTE:
                b'<html><head><link href="/assets/app.css"></head>'
                b'<body><script src="/assets/app.js"></script></body></html>',
            vob_online.ORIGIN + "/assets/app.js": self.javascript,
            vob_online.ORIGIN + "/assets/app.css": self.stylesheet,
        }

    def test_published_resources_require_vob_compatibility_and_hash_every_asset(self):
        manifest, resources = vob_online.published_resources(
            fetch=lambda url: self.responses[url],
        )
        self.assertEqual(manifest, self.manifest)
        self.assertEqual(set(resources), {
            vob_online.ROUTE,
            vob_online.ORIGIN + "/assets/app.js",
            vob_online.ORIGIN + "/assets/app.css",
        })

    def test_untracked_or_wrong_compatibility_build_is_rejected_before_document_fetch(self):
        for field, value in (
            ("trackedChangesAtBuild", True),
            ("vobEditorCompatibility", "aim-workv2-presentation-save/1"),
        ):
            with self.subTest(field=field):
                manifest = dict(self.manifest, **{field: value})
                fetched = []

                def fetch(url):
                    fetched.append(url)
                    return json.dumps(manifest).encode("utf-8")

                with self.assertRaisesRegex(ValueError, "incompatible"):
                    vob_online.published_resources(fetch=fetch)
                self.assertEqual(fetched, [vob_online.ORIGIN + "/build-manifest.json"])

    def test_asset_integrity_mismatch_is_rejected(self):
        responses = dict(self.responses)
        responses[vob_online.ORIGIN + "/assets/app.js"] = self.javascript + b"changed"
        with self.assertRaisesRegex(ValueError, "integrity"):
            vob_online.published_resources(fetch=lambda url: responses[url])

    def test_frontend_contract_and_route_are_required(self):
        responses = dict(self.responses)
        responses[vob_online.ORIGIN + "/assets/app.js"] = b"vob_editor"
        manifest = dict(self.manifest)
        manifest["files"] = [
            dict(item, sha256=hashlib.sha256(
                responses[vob_online.ORIGIN + item["file"]]
            ).hexdigest())
            for item in manifest["files"]
        ]
        responses[vob_online.ORIGIN + "/build-manifest.json"] = json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError, "contract"):
            vob_online.published_resources(fetch=lambda url: responses[url])
        with self.assertRaisesRegex(ValueError, "route"):
            vob_online.published_resources(route=vob_online.ORIGIN + "/information-manager")

    def test_api_requires_same_window_identity_before_initial_data_or_commands(self):
        class App:
            def __init__(self):
                self.calls = []

            def get_app_info(self):
                return {"app_id": "vob_editor", "capabilities": ["vob.save"]}

            def get_initial_data(self):
                self.calls.append("initial")
                return {"settings": {"lang": "fr"}}

            def call(self, command, payload):
                self.calls.append((command, payload))
                return {"ok": True, "data": None}

        app = App()
        api = vob_online.VobProtectedApi(app)
        with self.assertRaisesRegex(RuntimeError, "not active"):
            api.get_app_info()
        api.active = True
        with self.assertRaisesRegex(RuntimeError, "verified first"):
            api.get_initial_data()
        info = api.get_app_info()
        self.assertEqual(info, {"app_id": "vob_editor", "capabilities": ["vob.save"]})
        self.assertEqual(api.get_initial_data(), {"settings": {"lang": "fr"}})
        self.assertEqual(api.call("vob.save", {"file": None}), {"ok": True, "data": None})
        self.assertEqual(app.calls, ["initial", ("vob.save", {"file": None})])

    def test_api_rejects_identity_mismatch(self):
        class App:
            def get_app_info(self):
                return {"app_id": "information_manager"}

        api = vob_online.VobProtectedApi(App())
        api.active = True
        with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
            api.get_app_info()


if __name__ == "__main__":
    unittest.main()
