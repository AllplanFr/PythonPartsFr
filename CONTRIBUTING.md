# Contributing to ALLPLAN FRANCE PythonParts Collection

Thank you for contributing to this repository.

This file explains what kind of contributions are welcome, how to open issues, how to prepare pull requests, and which branches should be used. GitHub recommends a dedicated `CONTRIBUTING` file for this purpose so contributors know how to participate and which workflow to follow.

## Types of contributions

The following contributions are welcome:

- code for new PythonParts or improvements to existing assets,
- bug fixes,
- documentation updates,
- usage examples,
- issue reports,
- feature ideas and workflow suggestions,
- tests or validation feedback in ALLPLAN.

If a contribution is technically correct but does not fit the scope of the repository, maintainers may ask to reshape it before review.

## Before opening an issue

Before creating a new issue:

- check whether the topic is already reported,
- check whether the asset already exists or is already being discussed,
- gather the exact context needed to reproduce the problem in ALLPLAN.

For bugs, include at least:

- ALLPLAN version,
- asset name,
- exact steps to reproduce,
- expected behavior,
- actual behavior,
- exact error message if there is one.

## Issue guidelines

Use issues for:

- bug reports,
- new asset requests,
- improvement proposals,
- documentation problems.

Recommended title style:

- `[Bug] CircularReinforcement fails on update`
- `[Asset] New reinforcement helper`
- `[Docs] Improve installation section`

Please keep one main topic per issue.

## Branch model

The repository uses the following branch structure:

| Branch | Purpose |
|---|---|
| `main` | stable published branch |
| `template/interactor` | reference template for Interactor assets |
| `template/scriptobject` | reference template for ScriptObject assets |
| `dev/<NewAsset>` | development branch dedicated to one asset |

General rule:

- `main` must remain stable.
- Each new asset is developed in its own branch named `dev/<NewAsset>`.
- New assets start from the appropriate template branch depending on the implementation pattern.
- Pull requests are opened from `dev/<NewAsset>` to `main` once the asset is validated.
- Template branches are maintained only to evolve reusable asset skeletons.

## Pull request workflow

1. Fork the repository.
2. Create a branch from `dev`.
3. Make focused changes for one issue or one asset improvement.
4. Update documentation when needed.
5. Test the asset in ALLPLAN.
6. Open a pull request against `dev`.

A pull request should include:

- a clear title,
- the related issue when applicable,
- the target ALLPLAN version,
- a short summary of what changed,
- a short validation note describing how the change was tested.

## Asset templates

New assets should start from the repository templates maintained for the project.

Two main implementation patterns are used:

- `ScriptObject`
- `Interactor`

The [official PythonParts documentation](https://pythonparts.allplan.com/) distinguishes these two contracts and documents dedicated entry points for each implementation style.

## Repository structure

The `.pyp` represents the PythonPart in ALLPLAN and (in most cases) defines the layout of the palette.
The `.py` script, with the business logic of the PythonPart, contains functions required by the interface.

Typical structure:

```text
Library/ALLPLAN FRANCE/<AssetName>/<AssetName>.pyp
PythonPartsScripts/allplan_france/<AssetName>/__init__.py
PythonPartsScripts/allplan_france/<AssetName>/main.py
```

## Community expectations

By participating in this repository, contributors agree to follow the project [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
