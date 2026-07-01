# ALLPLAN FRANCE PythonParts Collection

Welcome to this GitHub project — a collection of **PythonParts** developed by **ALLPLAN FRANCE**.

## About the Project

This repository contains PythonParts utilities for ALLPLAN.  
These tools help automate repetitive tasks, streamline workflows, and deliver practical functionality for teams using ALLPLAN in their daily projects.

## Features

- Ready-to-use PythonParts utilities
- Based on the [ALLPLAN PythonParts API](https://pythonparts.allplan.com/)

## Installation

**ALLPLAN FRANCE PythonParts Collection** can be installed directly from the Plugin Manager in ALLPLAN.  
Alternatively, the corresponding `.allep` package can be downloaded from the [release page](https://github.com/AllplanFr/PythonPartsFr/releases).  
`.allep` files are ALLPLAN extension packages that can be installed via drag and drop into the program window.

## Requirements

- ALLPLAN >= 2026

## Branch Strategy

This repository is managed by **ALLPLAN version**.

- `main` contains the **current stable version** of the collection.
- stable versions published through the **Plugin Manager** are also distributed through GitHub **releases**
- version branches such as `2026` contain the codebase for a specific ALLPLAN version
- development for a given ALLPLAN release is done in its dedicated branch before being merged into `main`

In other words:

- `main` = current production-ready version
- `2026`, `2027`, ... = version-specific development and maintenance branches

## Installed Assets

The plugin installs the following assets into ALLPLAN:

- PythonParts utilities:
  - ...

They can be found in the Library under `Office` → `PythonParts` → `ALLPLAN FRANCE`.

## Repository Structure

A PythonPart in this repository is typically split into two parts:

- **front-end**: the `.pyp` file exposed in the ALLPLAN Library `PythonParts`
- **back-end**: the Python package located in `PythonPartsScripts`

The `.pyp` file is the entry point used by ALLPLAN to expose the tool in the Library, while the Python package contains the implementation logic and event handling. The official PythonParts documentation states that `.pyp` files are used to start a PythonPart from the ALLPLAN UI and must be placed in specific library directories.
The Python script side must be located in a `PythonPartsScripts` folder for execution.

## PythonPart Templates

Two main implementation patterns are used in this repository:

- **ScriptObject**
- **Interactor**

### ScriptObject

#### Front-end

```text
Library\PythonParts\ALLPLAN FRANCE\<AssetName>\<AssetName>.pyp
```

Example:

```xml
<?xml version="1.0" encoding="utf-8"?>

<Element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd">

    <LanguageFile><AssetName></LanguageFile>

    <Script>
        <Name>allplan_france\<AssetName>\__init__.py</Name>
        <Title><AssetTitle></Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
    </Script>

    <Page>
        ...
    </Page>

</Element>
```

### Back-end

```text
PythonPartsScripts\allplan_france\<AssetName>\
```

Typical files:

```text
__init__.py
main.py
```

`__init__.py` defines the PythonPart entry points, especially:

- `check_allplan_version`
- `create_script_object`

`main.py` contains the ScriptObject implementation and ALLPLAN event handling.

### Interactor

#### Front-end

```text
Library\PythonParts\ALLPLAN FRANCE\<AssetName>\<AssetName>.pyp
```

Example:

```xml
<?xml version="1.0" encoding="utf-8"?>

<Element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd">

    <LanguageFile><AssetName></LanguageFile>

    <Script>
        <Name>allplan_france\<AssetName>\__init__.py</Name>
        <Title><AssetTitle></Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
        <Interactor>True</Interactor>
    </Script>

    <Page>
        ...
    </Page>

</Element>
```

#### Back-end

```text
PythonPartsScripts\allplan_france\<AssetName>\
```

Typical files:

```text
__init__.py
main.py
```

`__init__.py` defines the PythonPart entry points, especially:

- `check_allplan_version`
- `create_preview`
- `create_interactor`

`main.py` contains the interactive behavior and event-driven logic.

## Contributing

Contributions are welcome. You can:

- propose new PythonParts utilities
- report bugs
- suggest improvements
- open issues or pull requests

Please follow the repository structure and naming conventions when adding a new asset.

## License

This project is distributed under the MIT License (see `LICENSE.md`).

## Contact

For questions, please open an issue on the repository.
