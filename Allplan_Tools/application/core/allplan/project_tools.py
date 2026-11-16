"""Shared project ownership and guarded prjtool execution; no UI or AIM state."""
from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
from uuid import uuid4

from .project_attribute_writer import SaveError, safe_path


@dataclass(frozen=True)
class ToolPlan:
    executable: Path
    project: Path
    cwd: Path
    command: str


def associated_installation(project, contexts):
    associated = {}
    for context in contexts:
        root = context.paths.get("PRJ")
        if root is None:
            continue
        safe_path(root)
        root = root.resolve(strict=True)
        if project != root and project.is_relative_to(root):
            key = (context.allplan_version, context.verification_version,
                   os.path.normcase(str(root)),
                   os.path.normcase(str(context.paths.get("PRG", ""))))
            associated[key] = context
    if not associated:
        return None
    if len(associated) != 1:
        raise SaveError("installation_ambiguous", "Plusieurs installations correspondent au projet.")
    return next(iter(associated.values()))


def tool_command(executable, project, prg):
    """A UNC project is an argument only; cmd.exe always starts in a local PRG."""
    for path, allow_unc in ((project, True), (prg, False), (executable, False)):
        value = str(path)
        unc = path.drive.startswith("\\\\")
        local = len(path.drive) == 2 and path.drive[0].isalpha() and path.drive[1] == ":"
        if (not path.is_absolute() or not (local or allow_unc and unc)
                or value.startswith(("\\\\?\\", "\\\\.\\"))
                or unc and len(path.parts) < 2
                or any(c in value for c in '%!^&|<>()"*?\r\n')
                or any(ord(c) < 32 for c in value)
                or ":" in value[2:]
                or any(part in (".", "..") or part.endswith((" ", "."))
                       for part in value.split("\\") if part)):
            raise SaveError("unsafe_tool_path", "Chemin shell non pris en charge ; aucune ecriture.")
    if executable.parent != prg:
        raise SaveError("unsafe_tool_path", "Executable hors du PRG valide ; aucune ecriture.")
    return subprocess.list2cmdline([str(executable), str(project), "-updateattr"])


def installation_tool_plan(project, context):
    if context is None:
        return None
    prg = context.paths.get("PRG")
    if prg is None:
        return ToolPlan(Path(), project, Path(), "")
    safe_path(prg)
    prg = prg.resolve(strict=False)
    executable = prg / "prjtool.exe"
    safe_path(executable)
    return ToolPlan(executable, project, prg, tool_command(executable, project, prg))


def tool_plan(project, contexts):
    return installation_tool_plan(project, associated_installation(project, contexts))


def execute_tool(plan, diagnostic_root, *, checkpoint=lambda *args: None):
    """Wait in the caller's worker; never kill/retry a potentially modifying tool."""
    safe_path(plan.cwd)
    safe_path(plan.executable)
    if plan.command != tool_command(plan.executable, plan.project, plan.cwd):
        raise SaveError("unsafe_tool_path", "Commande differente du plan valide.")
    shell = Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"
    if not shell.is_file():
        raise SaveError("shell_unavailable", "Shell Windows systeme indisponible.")
    diagnostic_root.mkdir(parents=True, exist_ok=True)
    identifier = uuid4().hex
    stdout = diagnostic_root / f"project-save-{identifier}.stdout.log"
    stderr = diagnostic_root / f"project-save-{identifier}.stderr.log"
    with stdout.open("xb") as out, stderr.open("xb") as err:
        process = subprocess.Popen(
            plan.command, cwd=plan.cwd, shell=True, executable=str(shell),
            stdout=out, stderr=err, stdin=subprocess.DEVNULL,
        )
        checkpoint("tool_launched", {"diagnosticId": identifier})
        returncode = process.wait()
        checkpoint("tool_finished", {"returnCode": returncode})
    return {"returncode": returncode, "stdout": stdout.name, "stderr": stderr.name}
