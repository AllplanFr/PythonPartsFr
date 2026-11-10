# SlabLabel | ALLPLAN FRANCE PythonParts Collection

`SlabLabel` is a PythonPart for ALLPLAN that creates associative slab labels showing elevations, thickness, spanning directions and an optional load attribute.

## What this asset does

- Creates one label per selected slab in the active drawing file.
- Displays the upper elevation and the thickness of the lowest slab layer.
- Optionally displays the finished floor level of multilayer slabs, using the upper elevation of the highest layer.
- Displays spanning arrows in one or both directions, with an adjustable rotation.
- Connects the label to opposite slab corners with optional leader lines.
- Optionally adds the project's vertical offset to displayed elevations.
- Supports custom thickness text, including sums such as `16+4`, with a visual consistency check.
- Optionally displays slab attribute `18280` when a value is available.
- Provides three scale-dependent representations and English/French palette labels.

Spanning arrows are annotation graphics, not the result of a structural analysis. Check their direction against the project design.

## Where to find it

After installation, the asset is available in the ALLPLAN Library under:

`Office` → `ALLPLAN FRANCE` → `Engineering` → `Slab label`

In the French interface, the `Engineering` folder is displayed as `Ingénierie`, and the asset is named `Annotation de dalle`.

## How to use it

1. Open the ALLPLAN Library.
2. Navigate to `Office` → `ALLPLAN FRANCE` → `Engineering`.
3. Start `Slab label`.
4. Set the display and format options in the PythonPart property palette.
5. Select the slabs to annotate in the active drawing file and complete the selection.
6. The tool creates one associated label per selected slab.
7. Modify an existing label to adjust its options. Move it to reposition the label while keeping its slab connection.

For a custom thickness, enable the checkbox and enter the text to display. For example, enter `16+4` for a 20 cm thickness with the unit set to `cm`. The original expression remains visible in the label, and the validation icon indicates whether the sum matches the reference thickness.

## Parameters

| Section | Parameter | Type | Description | Default |
|---------|-----------|------|-------------|---------|
| Global / Display | Spanning (`SpanningDirection`) | Picture combo box | None, direction 1, direction 2 or both. At creation, an initial direction is inferred from four-segment footprints. | None before automatic initialization |
| Global / Display | Rotation (`ZRotation`) | Angle | Rotates the spanning arrows from -89 to 89 degrees. The adjacent buttons change the value by 1 degree. | 0 before automatic initialization |
| Global / Display | Leader line direction (`LeaderLine`) | Picture combo box | No leader lines, or one of two opposite-corner arrangements. | Direction 1 |
| Global / Display | Georeferencing (`GeorefPointOffset`) | Checkbox | Adds the Z component of the project offset to displayed elevations. Does not move the geometry. | Disabled |
| Global / Display | Altimetry (`GeorefZOffset`) | Read-only length | Displays the Z component of the project offset. Visible when georeferencing is enabled. | Current project offset Z |
| Global / Display | Thickness in (`ThicknessUnit`) | String combo box | Unit of the automatic thickness and of the custom thickness comparison: `cm` or `m`. | `cm` |
| Global / Display | Custom thickness (`CustomThickCheckbox`) | Checkbox | Replaces the automatic thickness label with custom text. | Disabled |
| Global / Display | Custom text (`CustomThickValue`) | String | Text displayed in the label. Numeric sums accept decimal points or commas. | Empty |
| Global / Display | Reference thickness (`InitThickValue`) | Read-only string | Thickness of the lowest layer, shown in parentheses and used by the check. | Calculated during creation |
| Global / Display | Thickness check (`ThickValidatePicture`) | Picture button | Shows a validation icon when a recognized sum matches the reference thickness; otherwise shows the default icon. | Default icon |
| Global / Display | Show finished floor level (`ShowFinishedFloorLevel`) | Checkbox | Displays the upper level of the highest layer for multilayer slabs only. | Enabled |
| Global / Display | Show load class (`ShowLoadClass`) | Checkbox | Displays slab attribute `18280` if it is not empty. | Enabled |
| Options / Format | Format (`LabelCommonProp`) | Common properties | Sets the common drawing properties of the annotation. Spanning arrows use pen 4. | Layer `3746` |

## How it works

The tool filters the selection to slab elements in the active drawing file. Selected layers are resolved to their parent slab, and each parent slab is processed only once per session.

For each slab, the tool reads the valid polyhedral layer geometries and computes their minimum and maximum Z coordinates. Layers are sorted by upper elevation:

- The structural level and the automatic thickness come from the lowest layer.
- The finished floor level comes from the highest layer, when several layers exist.
- Elevations are displayed in metres with two decimals and a sign.
- Thickness is displayed as an integer in centimetres, or with three decimals in metres.

The initial label position is the midpoint between the centres of gravity of the first and last processed layers. The footprint of the thickest layer provides the corner references and the initial spanning-direction inference. Four-segment footprints are analysed by edge length and orientation; footprints with a shortest-to-longest edge ratio of at least 0.95 receive arrows in both directions. Other footprints keep the initial direction set to none.

### Scale-dependent representations

Three 2D representations are declared for scale denominators 0-50, 50-100 and 100-9999, with nominal factors 1, 2 and 4. Each representation is built independently from the local, unscaled annotation geometry. Scaling is applied first, then the label displacement is added. As a result, moving the label produces the same displacement in every representation, while the symbol, arrows and texts keep their own scale. Leader endpoints on the slab remain fixed.

### Association and modification

Labels are connected to their source slab through a PythonPart association. A manual move updates the stored label displacement without modifying the source slab. If the connected slab is no longer available, the PythonPart is deleted; the association list is checked before the observed slab is accessed.

### Custom thickness check

The check accepts a number or a sum of non-negative numbers, such as `20`, `16+4` or `15,5 + 4,5`, expressed in the selected thickness unit. The comparison uses an absolute tolerance of `0.001` against the thickness of the lowest layer. Text is never evaluated as Python code.

Free text and unsupported expressions remain displayable but are not numerically checked. In that case, the validation icon is reset to its default state.

### Georeferencing

When the option is enabled, the Z component of the active project's offset is added to the displayed elevations. X and Y offsets are not applied.

## Requirements

- ALLPLAN 2026 or newer, as enforced by the package version check.
- The Python environment embedded in the target ALLPLAN installation.
- Native slab elements with valid polyhedral layer geometry in the active drawing file.
- The package modules, the `.pyp` palette and the corresponding language files installed together.

## Any Issues?

If you have identified any issues, please [open an issue](https://github.com/AllplanFr/PythonPartsFr/issues).
