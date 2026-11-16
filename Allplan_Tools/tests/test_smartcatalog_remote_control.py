import unittest
from unittest.mock import patch

from application.core.context import LaunchContext, context_to_arguments
from application.core.errors import LaunchError
from application.launcher.main import main
from application.launcher.smartcatalog_remote_control import (
    RemoteRecipeNotReady,
    RemoteRecipePolicy,
    require_reviewed_recipe,
)


DOCUMENT = "https://recipe.invalid/editor?mode=control"
SCRIPT = "https://assets.invalid/smartcatalog.abc123.js"


class RemoteRecipePolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = RemoteRecipePolicy(DOCUMENT, frozenset({SCRIPT}))

    def test_exact_main_document_only_and_no_redirects(self):
        self.assertTrue(self.policy.allows_navigation(DOCUMENT))
        for url in (
            "https://recipe.invalid/editor",
            "https://recipe.invalid/editor?mode=normal",
            "https://recipe.invalid/vob-editor?mode=control",
            "https://allplan-tools.lovable.app/",
            "https://allplan-tools.lovable.app/vob-editor",
        ):
            with self.subTest(url=url):
                self.assertFalse(self.policy.allows_navigation(url))
        self.assertFalse(self.policy.allows_navigation(DOCUMENT, is_redirect=True))
        self.assertFalse(self.policy.allows_navigation(DOCUMENT, is_top_level=False))
        self.assertFalse(self.policy.allows_navigation(DOCUMENT, is_popup=True))
        self.assertFalse(self.policy.allows_navigation(DOCUMENT, is_auth_flow=True))

    def test_only_inventoried_get_subresources_from_recipe_document(self):
        self.assertTrue(self.policy.allows_resource(
            SCRIPT, method="GET", source_url=DOCUMENT,
        ))
        for values in (
            {"method": "POST"},
            {"source_url": "https://recipe.invalid/other"},
            {"resource_kind": "frame"},
            {"resource_kind": "worker"},
            {"resource_kind": "service_worker"},
            {"is_redirect": True},
            {"is_auth_flow": True},
        ):
            args = {"method": "GET", "source_url": DOCUMENT, **values}
            with self.subTest(values=values):
                self.assertFalse(self.policy.allows_resource(SCRIPT, **args))
        self.assertFalse(self.policy.allows_resource(
            "https://assets.invalid/unknown.js",
            method="GET", source_url=DOCUMENT,
        ))

    def test_invalid_or_non_exact_policy_urls_are_rejected(self):
        for document, resources in (
            ("http://recipe.invalid/", frozenset({SCRIPT})),
            ("https://user@recipe.invalid/", frozenset({SCRIPT})),
            ("https://recipe.invalid/#fragment", frozenset({SCRIPT})),
            ("https://recipe.invalid/editor*", frozenset({SCRIPT})),
            (DOCUMENT, frozenset()),
            (DOCUMENT, frozenset({"https://assets.invalid/" + "*"})),
            (DOCUMENT, {SCRIPT}),
        ):
            with self.subTest(document=document, resources=resources):
                with self.assertRaises(ValueError):
                    RemoteRecipePolicy(document, resources)

    def test_missing_reviewed_frontend_evidence_is_a_hard_gate(self):
        with self.assertRaisesRegex(RemoteRecipeNotReady, "aucun retour frontend"):
            require_reviewed_recipe()
        with patch(
            "application.launcher.smartcatalog_remote_control._REVIEWED_RECIPE_EVIDENCE",
            {"document_url": DOCUMENT},
        ), self.assertRaisesRegex(RemoteRecipeNotReady, "ne constituent pas une autorisation"):
            require_reviewed_recipe()


class SmartCatalogRemoteCliTests(unittest.TestCase):
    def test_exact_opt_in_fails_closed_without_starting_any_adapter(self):
        with patch(
            "application.launcher.smartcatalog_remote_control.require_reviewed_recipe",
            side_effect=RemoteRecipeNotReady("Essai distant SmartCatalog non execute."),
        ), patch("application.launcher.main.resolve_context") as resolve, patch(
            "application.launcher.main.run_app"
        ) as normal, patch(
            "application.launcher.protocol_control.run_control_test"
        ) as local, patch(
            "application.launcher.main.context_from_arguments"
        ) as context:
            with self.assertRaises(LaunchError) as caught:
                main(["smartcatalog", "--protocol-smartcatalog-test"])
        self.assertIn("Essai distant SmartCatalog non execute", caught.exception.message)
        resolve.assert_not_called()
        context.assert_not_called()
        normal.assert_not_called()
        local.assert_not_called()
        self.assertNotIn(
            "--protocol-smartcatalog-test", context_to_arguments(LaunchContext()),
        )

    def test_rejects_other_plugins_and_business_context(self):
        for arguments in (
            ["vob_editor", "--protocol-smartcatalog-test"],
            ["smartcatalog", "--protocol-smartcatalog-test", "--project-path", "project"],
            ["smartcatalog", "--protocol-smartcatalog-test", "--paths", "paths.json"],
            ["smartcatalog", "--protocol-smartcatalog-test", "--diagnostic"],
            ["smartcatalog", "--protocol-smartcatalog-test", "--origin", "allplan"],
            ["smartcatalog", "--protocol-smartcatalog-test", "--initial-path", "input.vob"],
        ):
            with self.subTest(arguments=arguments), self.assertRaises(LaunchError):
                main(arguments)

    def test_local_and_remote_opt_ins_are_mutually_exclusive(self):
        with self.assertRaises(LaunchError):
            main([
                "smartcatalog", "--protocol-control-test",
                "--protocol-smartcatalog-test",
            ])


if __name__ == "__main__":
    unittest.main()
