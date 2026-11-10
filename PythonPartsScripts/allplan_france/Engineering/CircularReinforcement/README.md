# CircularReinforcement | ALLPLAN FRANCE PythonParts Collection

`CircularReinforcement` is a PythonPart for ALLPLAN that generates parametric circular reinforcement directly as native reinforcement elements.

It creates curved bars within a circular zone defined by inner and outer radii, with configurable bar length, diameter, concrete cover and radial spacing. An optional vertical distribution creates several layers of reinforcement.

No conversion from drawing geometry to reinforcement is required.

## What this asset does

- Generates native curved reinforcement bars.
- Defines the reinforcement zone using inner and outer radii.
- Provides two geometric arrangements:
  - Form A: bars share the same arc length, with an angle calculated for each radius.
  - Form B: bars share the same angle, calculated from the outer reinforcement radius and the specified bar length.
- Positions bars radially from inside to outside or from outside to inside.
- Supports constant radial spacing or a sequence of spacings.
- Optionally distributes the reinforcement vertically, by count or spacing.
- Sets the base elevation from the bottom plane reference.
- Applies a global rotation to the reinforcement arrangement.
- Provides handles for adjusting the inner and outer radii.
- Provides separate drawing properties for the reference geometry and reinforcement.
- Supports English and French palette labels.

The tool generates reinforcement geometry from the supplied parameters. It does not perform structural design or verify compliance with reinforcement design rules.

## Where to find it

After installation, the asset is available in the ALLPLAN Library under:

`Office` → `ALLPLAN FRANCE` → `Engineering` → `Circular Reinforcement`

In the French interface, the `Engineering` folder is displayed as
`Ingénierie`, and the asset is named `Armatures circulaires`.

## How to use it

1. Open the ALLPLAN Library.
2. Navigate to `Office` → `ALLPLAN FRANCE` → `Engineering`.
3. Start `Circular Reinforcement`.
4. Enter a zone name.
5. Define the inner radius, outer radius, global rotation and bottom plane reference.
6. Set the concrete cover and bar diameter.
7. Select Form A or Form B and enter the bar length.
8. Choose the radial distribution direction and define the radial spacing.
9. If required, enable vertical distribution and configure its count or spacing and height.
10. Set the drawing properties in the Options page.
11. Confirm the placement in the drawing.
12. Check the generated reinforcement against the project requirements.

## Parameters

| Section | Parameter | Description | Default |
|---------|-----------|-------------|---------|
| Global / Name | Name (`ZoneName`) | Designation stored on the PythonPart using attribute `507`. | `Zone name` |
| Global / Geometry | Inner radius (`InnerRadius`) | Inner radius of the reference zone. | 5000 mm |
| Global / Geometry | Outer radius (`OuterRadius`) | Outer radius of the reference zone. | 20000 mm |
| Global / Geometry | Global rotation (`Rotation`) | Rotation of the reference geometry and reinforcement about the vertical axis. | 45° |
| Global / Geometry | Bottom plane (`BottomPlane`) | Plane reference used to determine the base elevation of the bars. | Defined through the plane reference control |
| Global / Reinforcement | Concrete cover (`ReinfConcreteCover`) | Offset applied at the radial boundaries and at both ends of the optional vertical distribution. | 30 mm |
| Global / Reinforcement | Bar diameter (`CircularBarDiameter`) | Diameter of the generated reinforcement bars. | 16 mm |
| Global / Reinforcement | Form (`FormRadioGroup`) | Selects equal arc lengths (A) or a common angle (B). | A |
| Global / Reinforcement | Bar length (`CircularBarLength`) | Arc length used to calculate each bar angle in Form A, or the outermost bar angle in Form B. | 12000 mm |
| Global / Reinforcement | Direction (`DistributionDirection`) | Radial progression from inside to outside or from outside to inside. | From inside to outside |
| Global / Reinforcement | Bar spacing (`CircularBarSpacing`) | Radial spacing expression, in millimetres. | `250` |
| Global / Reinforcement | Enable distribution (`DistributionCheckBox`) | Enables vertical distribution of the curved bars. | Disabled |
| Global / Reinforcement | By (`DistribTypeRadioGroup`) | Defines vertical distribution by count or spacing. | Spacing |
| Global / Reinforcement | Count (`DistribCount`) | Number of bars in each vertical distribution when using count mode. | 5 |
| Global / Reinforcement | Spacing (`DistribSpacing`) | Vertical spacing when using spacing mode. | 250 mm |
| Global / Reinforcement | Distribution height (`DistribHeight`) | Height used to define the vertical distribution, with concrete cover applied at both ends. | 1000 mm |
| Options / Format | PythonPart (`CommonProp`) | Drawing properties of the reference geometry. | Construction lines enabled |
| Options / Format | Reinforcement (`ReinfProp`) | Drawing properties applied to the reinforcement placements. | Layer `3864` |

The numerical length defaults above are expressed in ALLPLAN's internal millimetres. Palette display follows the applicable unit settings.

## How it works

### Reference geometry

The PythonPart creates a 2D reference representation containing:

- The inner circle.
- The outer circle.
- A radial reference line.

The global rotation applies to this representation and to the generated reinforcement.

### Radial positioning

The reinforcement radii are calculated between:

- Inner radius + concrete cover.
- Outer radius − concrete cover.

The first radius is placed at the selected starting boundary. Further radii are generated by applying the spacing expression in the selected direction.

The spacing expression controls the radial distance between successive bars, not the distance along their arcs.

Keep the radii and concrete cover consistent so that the resulting reinforcement zone remains valid.

### Form A — Equal arc lengths

Each bar angle is calculated independently from its radius and the specified bar length.

All bars therefore share the same target arc length, while their end angles differ.

### Form B — Common angle

A single angle is calculated from the outermost reinforcement radius and the specified bar length.

All bars share this angle. The outermost bar has the specified target arc length, while bars at smaller radii are shorter.

### Radial spacing expressions

Enter radial spacings in millimetres.

#### Constant spacing

```text
250
```

Repeats a spacing of 250 mm until the next radius would exceed the reinforcement zone.

#### Spacing sequence

```text
150 ; 3*250 ; 500
```

Applies:

1. One spacing of 150 mm.
2. Three spacings of 250 mm.
3. One spacing of 500 mm.

The sequence is applied once. It stops earlier if the next radius would exceed the reinforcement zone.

All spacing values must be strictly positive. Repetition counts must be positive integers.

### Elevation and vertical distribution

The bottom plane reference determines the base elevation of the curved bar shapes.

When vertical distribution is disabled, the tool creates one bar at each generated radius.

When vertical distribution is enabled, each curved shape is distributed along the vertical axis using either:

- A specified bar count.
- A specified bar spacing.

The distribution height defines the vertical distribution range, with concrete cover applied at both ends.

### Native reinforcement

For each generated radius, the tool creates a curved reinforcement shape and a native reinforcement placement.

The reinforcement placements are included in the resulting PythonPart together with the 2D reference geometry.

The generated reinforcement does not require a separate conversion step.

### Modification

Modify the PythonPart to update its parameters.

The inner and outer radius handles provide direct control over the reference zone boundaries.

## Requirements

- ALLPLAN 2026 or newer, as enforced by the package version check.
- The Python environment embedded in the target ALLPLAN installation.
- The Python package modules, `.pyp` palette, language files and referenced palette images installed together.

## Limitations and checks

- The tool creates reinforcement geometry; it does not calculate required reinforcement areas.
- Bar length is used as a geometric arc-length input, not as a verified fabrication or cutting length.
- Radial spacing and optional vertical spacing are separate settings.
- A spacing sequence is applied once; it is not automatically repeated to fill the remaining radial zone.
- Check the generated geometry, bar properties, concrete cover and placements before using the result in production documents.

## Any Issues?

If you have identified any issues, please [open an issue](https://github.com/AllplanFr/PythonPartsFr/issues).