# Allplan Tools

Allplan Tools provides a shared home screen and launcher for Information Manager
(AIM), SmartCatalog Editor and VOB Editor, with Python host integration for Allplan.

## Folder organization

- [application/](application/): shared Python application and plugin sources.
- [allplan_tools/](allplan_tools/): home runtime, PythonPart entries and recipe assembly tools;
  see the [integration recipe documentation](allplan_tools/README.md).
- [frontend/](frontend/): home and application frontend sources, including dedicated build tooling.
- [tests/](tests/): Python tests.
- [INTEGRATION_PROVENANCE.md](INTEGRATION_PROVENANCE.md): retained source provenance and historical integration notes.
- [requirements.txt](requirements.txt) and [pyproject.toml](pyproject.toml): Python dependencies and project configuration.

## Operation and dependencies

The retained integrated recipe starts the applications offline by default through
pinned local deliveries. Online launch paths remain available. A local delivery
validation failure never triggers an automatic network fallback.

The current recipe still requires an external pinned AIM delivery and an external
Python interpreter; the source folder alone is not a standalone installation.

## Integration and delivery status

The validated sources are integrated into `upstream/main`. This does not mean that
a distribution package or an update catalog has been published.

Frontend provenance is **base 5c8e624 plus a local Home-close correction**, not an
unchanged copy of the original commit.

User validation of Lovable modifications is required **before both creating and
using any new corresponding ZIP**.
