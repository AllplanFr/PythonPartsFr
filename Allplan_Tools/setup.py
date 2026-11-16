"""Copy the single normative RC1 artifact source into built distributions."""
from pathlib import Path
import hashlib
import json
import shutil

from setuptools import setup
from setuptools.command.build_py import build_py


class BuildPy(build_py):
    def run(self):
        super().run()
        source = Path(__file__).parent / "docs" / "integration" / "protocol" / "2.0.0-rc.1"
        target = Path(self.build_lib) / "application" / "core" / "resources" / "protocol" / source.name
        manifest = json.loads((source / "manifest.json").read_bytes())
        target.mkdir(parents=True, exist_ok=True)
        for name in ("schema.json", "fixtures.json", "manifest.json"):
            original = (source / name).read_bytes()
            if name in manifest["sha256"]:
                if hashlib.sha256(original).hexdigest() != manifest["sha256"][name]:
                    raise RuntimeError(f"RC1 release integrity failure before build: {name}")
            shutil.copyfile(source / name, target / name)
            if (target / name).read_bytes() != original:
                raise RuntimeError(f"RC1 release bytes changed during build: {name}")


setup(cmdclass={"build_py": BuildPy})
