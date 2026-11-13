import base64
from pathlib import Path
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext
from application.core.allplan.project_attribute_writer import SaveError
from application.core.allplan import project_tools
from application.plugins.information_manager import project_save
from tests import test_aim_project_save as service_fixture


class UncPlanTests(unittest.TestCase):
    def test_unc_membership_uses_discovered_root_without_local_alias(self):
        project = Path(r"\\server\share name\Prj\Project name.prj")
        context = LaunchContext(allplan_version="2026", paths={
            "PRJ": Path(r"\\server\share name\Prj"),
            "PRG": Path(r"C:\Program Files\Allplan\Prg"),
        })
        with patch.object(project_tools, "safe_path"), patch.object(Path, "resolve", lambda p, **kw: p):
            self.assertIs(project_save.associated_installation(project, [context]), context)
            plan = project_save.installation_tool_plan(project, context)
            self.assertEqual(plan.project, project)
            self.assertEqual(plan.cwd, context.paths["PRG"])
            self.assertEqual(plan.command, (
                '"C:\\Program Files\\Allplan\\Prg\\prjtool.exe" '
                '"\\\\server\\share name\\Prj\\Project name.prj" -updateattr'
            ))
            self.assertIsNone(project_save.associated_installation(
                Path(r"C:\Data\Prj\Project name.prj"), [context]))

    def test_unsafe_argument_and_cwd_namespaces_are_rejected(self):
        prg = Path(r"C:\Program Files\Allplan\Prg")
        executable = prg / "witness.exe"
        projects = [
            Path(r"\\server\share\Prj\unsafe" + c + "name.prj")
            for c in '%!^&|<>()"*?\r\n\x01'
        ] + [
            Path(r"\\?\UNC\server\share\Prj\project.prj"),
            Path(r"\\.\pipe\project"),
            Path(r"\\server\share"),
            Path(r"\\server\share\Prj\..\project.prj"),
            Path(r"\\server\share\Prj\project.prj."),
            Path(r"C:\Prj\project:stream"),
            Path(r"C:relative.prj"),
        ]
        for project in projects:
            with self.subTest(project=str(project)), self.assertRaises(SaveError) as caught:
                project_save.tool_command(executable, project, prg)
            self.assertEqual(caught.exception.code, "unsafe_tool_path")
        for cwd in (Path(r"\\server\share\Prg"), Path(r"C:Prg"),
                    Path(r"C:\unsafe & Prg"), Path(r"\\?\C:\Prg")):
            with self.subTest(cwd=str(cwd)), self.assertRaises(SaveError):
                project_save.tool_command(cwd / "witness.exe", Path(r"\\server\share\Prj\P.prj"), cwd)
        with self.assertRaises(SaveError):
            project_save.tool_command(Path(r"C:\Other\witness.exe"),
                                      Path(r"\\server\share\Prj\P.prj"), prg)

    def test_unsafe_project_is_refused_before_prepare_and_process(self):
        fixture = service_fixture.ServiceTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.allplan()
        bad = fixture.f.project.parent / "unsafe & project.prj"
        fixture.f.project.rename(bad)
        fixture.f.project = bad
        fixture.f.path = bad / "prjatt.dat"
        fixture.app._state = fixture.app._load(bad, [], remember=False)
        fixture.set_value("controlled")
        before = fixture.f.path.read_bytes()
        with patch.object(project_save, "prepare") as prepare:
            result = fixture.save()
        self.assertEqual(result["error"]["code"], "unsafe_tool_path")
        self.assertFalse(result["written"])
        prepare.assert_not_called()
        fixture.runner.assert_not_called()
        self.assertEqual(fixture.f.path.read_bytes(), before)
        self.assertEqual(list(bad.glob("*.bak")), [])
        self.assertTrue(fixture.app._work.dirty()["values"])


@unittest.skipUnless(os.name == "nt", "Real Windows cmd.exe witness required")
class WindowsArgumentWitnessTests(unittest.TestCase):
    observations = []

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="AIM UNC witness ")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.prg = cls.root / "Program files Allplan" / "Prg"
        cls.prg.mkdir(parents=True)
        cls.executable = cls.prg / "argument-witness.exe"
        compiler = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
        source = Path(__file__).parent / "fixtures/project-save/argument_witness.cs"
        subprocess.run([str(compiler), "/nologo", "/target:exe",
                        "/out:" + str(cls.executable), str(source)],
                       check=True, capture_output=True)

    def test_real_cmd_transport_spaces_and_non_shell_punctuation(self):
        original_cwd = Path.cwd()
        for name in ("Project with spaces.prj", "été $value; 'literal'.prj"):
            project = Path(r"\\server\share with spaces\Prj") / name
            command = project_save.tool_command(self.executable, project, self.prg)
            plan = project_save.ToolPlan(self.executable, project, self.prg, command)
            checkpoints = []
            with patch.object(project_save.subprocess, "Popen", wraps=subprocess.Popen) as popen:
                result = project_save.execute_tool(
                    plan, self.root / "diagnostics",
                    checkpoint=lambda event, facts: checkpoints.append((event, facts)),
                )
            popen.assert_called_once()
            self.assertIs(popen.call_args.kwargs["shell"], True)
            self.assertEqual(popen.call_args.kwargs["cwd"], self.prg)
            stdout = (self.root / "diagnostics" / result["stdout"]).read_text("ascii")
            observed = [base64.b64decode(line).decode("utf-8") for line in stdout.splitlines()]
            self.observations.append({
                "command": command, "observedCwdAndArguments": observed,
                "returnCode": result["returncode"], "shell": popen.call_args.kwargs["shell"],
                "cwdUnchanged": Path.cwd() == original_cwd,
            })
            self.assertEqual(observed, [str(self.prg), str(project), "-updateattr"])
            self.assertEqual(result["returncode"], 0)
            self.assertEqual((self.root / "diagnostics" / result["stderr"]).read_bytes(), b"")
            self.assertEqual([x[0] for x in checkpoints], ["tool_launched", "tool_finished"])
            self.assertEqual(Path.cwd(), original_cwd)

    def test_injection_and_expansion_refused_without_process_or_marker(self):
        marker = self.root / "unexpected-command.txt"
        values = (
            r"\\server\share\project & echo unexpected>" + str(marker),
            r"\\server\share\%TEMP%\project.prj",
            r"\\server\share\!TEMP!\project.prj",
            r'\\server\share\project" & echo unexpected',
            r"\\server\share\project^&echo.prj",
            r"\\server\share\project|echo.prj",
        )
        with patch.object(project_save.subprocess, "Popen") as popen:
            for value in values:
                with self.subTest(value=value), self.assertRaises(SaveError):
                    project_save.tool_command(self.executable, Path(value), self.prg)
        popen.assert_not_called()
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
