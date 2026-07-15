# PythonPartBuilder | ALLPLAN FRANCE PythonParts Collection

`PythonPartBuilder` is a PythonPart for ALLPLAN that creates parametric PythonPart objects from existing 2D and/or 3D elements.

## What this asset does

`PythonPartBuilder` generates a parametric PythonPart (object, `.py` script and `.pyp` interface file) from 2D/3D elements selected in the Allplan document.

These elements can be native Allplan elements or elements imported from other software using recognized formats such as IFC.

For each variant of the future PythonPart, the user defines an **objects / reference point** pair.
Variants can be added dynamically via the "Add Variant" button, allowing several configurations within a single PythonPart.

Optional attributes can also be attached to the generated PythonPart via the `Attributes` section of the palette.

The generated PythonPart is immediately visible and functional in Allplan; it can also be manually completed or edited in the Python script afterwards if needed.

## Where to find it

After installation, the asset is available in the ALLPLAN Library under:

`Office` → `ALLPLAN FRANCE` → `PythonPartBuilder`

## How to use it

1. Open the ALLPLAN Library.
2. Navigate to `Office` → `ALLPLAN FRANCE`.
3. Start `PythonPartBuilder`.
4. Fill in the parameters in the PythonPart property palette.
5. Validate the creation in the drawing.

## Parameters

| Section | Parameter | Type | Description | Default |
|---------|-----------|------|--------------|---------|
| Global data | PythonPart name | `String` | Name of the PythonPart to generate | My PythonPart |
| Geometry | Variant(s) | `Dynamic List` | For each variant: selection of objects (2D/3D) + associated reference point. Click "Add Variant" to add more | 1 variant |
| Attributes | Attributes | `Attribute List` | Optional attributes attached to the generated PythonPart | none |
| Options | File location | `RadioButtonGroup` | Storage location of the generated PythonPart: `STD` (Office), `PRJ` (Project), `USR` (User) | STD |

## How it works

- Select one or more 2D/3D objects for each desired variant.
- Assign a reference point to each selection; this point will serve as the insertion point of the generated PythonPart.
- Use the "Add Variant" button to add as many object/reference point pairs as needed.
- Optionally attach attributes to the generated PythonPart in the Attributes section.
- Choose the storage location: `STD` (Office), `PRJ` (Project), or `USR` (User), depending on the desired distribution scope.
- The `.py` script and `.pyp` interface file are generated automatically, and the PythonPart is immediately usable from the library.

## Switching variants without opening the PythonPart

`PythonPartBuilder` automatically creates a dedicated attribute (e.g. `MyPythonPart_variant`), exposed as a **ListBox without entry** containing all defined variant names.

- Changing this attribute value directly updates the PythonPart geometry to the selected variant, without needing to double-click and reopen the PythonPart interaction.
- This attribute is available from the standard Allplan property palette, making variant switching quick and accessible.
- It also supports **multi-selection**: selecting several instances of the same generated PythonPart and changing the attribute value updates all of them to the chosen variant at once.

## Requirements

- ALLPLAN 2026 or newer

## Any Issues?

If you have identified any issues, please [open an issue](https://github.com/AllplanFr/PythonPartsFr/issues).