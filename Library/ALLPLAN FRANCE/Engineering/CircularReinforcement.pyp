<?xml version="1.0" encoding="UTF-8"?>

<Element xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:noNamespaceSchemaLocation="https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd">

    <LanguageFile>CircularReinforcement</LanguageFile>

    <Script>
        <Name>allplan_france\Engineering\CircularReinforcement\__init__.py</Name>
        <Title>Circular Reinforcement</Title>
        <TextId>1001</TextId>
        <Version>2.0</Version>
    </Script>

    <Constants>
        <Constant>
            <Name>README</Name>
            <Value>9999</Value>
            <ValueType>Integer</ValueType>
        </Constant>
    </Constants>

    <Page>

        <Name>GlobalPage</Name>
        <Text>Global</Text>
        <TextId>2001</TextId>

        <Parameters>

            <Parameter>
                <Name>ReadMeButtonRow</Name>
                <Text>🌐</Text>
                <ValueType>Row</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>Button</Name>
                        <Text>?</Text>
                        <EventId>README</EventId>
                        <ValueType>Button</ValueType>
                        <Value>
                            https://github.com/AllplanFr/PythonPartsFr/blob/main/PythonPartsScripts/allplan_france/Engineering/CircularReinforcement/README.md</Value>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>NameExpander</Name>
                <Text>Name</Text>
                <TextId>2002</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>ZoneName</Name>
                        <Text>Name</Text>
                        <TextId>2003</TextId>
                        <Value>Zone name</Value>
                        <ValueType>String</ValueType>
                    </Parameter>
                </Parameters>
            </Parameter>

            <Parameter>
                <Name>GeometryExpander</Name>
                <Text>Geometry</Text>
                <TextId>2004</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>InnerRadius</Name>
                        <Text>Inner radius</Text>
                        <TextId>2005</TextId>
                        <Value>5000.</Value>
                        <ValueType>Length</ValueType>
                        <MinValue>100</MinValue>
                    </Parameter>

                    <Parameter>
                        <Name>OuterRadius</Name>
                        <Text>Outer radius</Text>
                        <TextId>2006</TextId>
                        <Value>20000.</Value>
                        <ValueType>Length</ValueType>
                        <MinValue>InnerRadius + 100</MinValue>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Rotation</Name>
                        <Text>Global rotation</Text>
                        <TextId>2007</TextId>
                        <Value>45</Value>
                        <ValueType>Angle</ValueType>
                        <MinValue>0</MinValue>
                        <MaxValue>360</MaxValue>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>BottomPlane</Name>
                        <Text>Bottom plane</Text>
                        <TextId>2008</TextId>
                        <Value />
                        <ValueType>PlaneReferences</ValueType>
                        <ValueDialog>BottomPlaneReferences</ValueDialog>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>ReinforcementExpander</Name>
                <Text>Reinforcement</Text>
                <TextId>2009</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>ReinfConcreteCover</Name>
                        <Text>Concrete cover</Text>
                        <TextId>2010</TextId>
                        <Value>30</Value>
                        <ValueType>ReinfConcreteCover</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>CircularBarDiameter</Name>
                        <Text>Bar diameter</Text>
                        <TextId>2011</TextId>
                        <Value>16</Value>
                        <ValueType>ReinfBarDiameter</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>FormRadioGroup</Name>
                        <Text>Form</Text>
                        <TextId>2012</TextId>
                        <Value>A</Value>
                        <ValueType>RadioButtonGroup</ValueType>
                        <Parameters>
                            <Parameter>
                                <Name>FormRadioButtonA</Name>
                                <Text>A</Text>
                                <TextId>2013</TextId>
                                <Value>A</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>FormRadioButtonB</Name>
                                <Text>B</Text>
                                <TextId>2014</TextId>
                                <Value>B</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>FormAPicture</Name>
                        <Value>images\FormA.png</Value>
                        <Orientation>Middle</Orientation>
                        <ValueType>Picture</ValueType>
                        <Visible>FormRadioGroup == 'A'</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>FormBPicture</Name>
                        <Value>images\FormB.png</Value>
                        <Orientation>Middle</Orientation>
                        <ValueType>Picture</ValueType>
                        <Visible>FormRadioGroup == 'B'</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>CircularBarLength</Name>
                        <Text>Bar length</Text>
                        <TextId>2015</TextId>
                        <Value>12000.</Value>
                        <MinValue>10.</MinValue>
                        <ValueType>Length</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>DistributionDirection</Name>
                        <Text>Direction</Text>
                        <TextId>2016</TextId>
                        <Value>0</Value>
                        <ValueList>0|1</ValueList>
                        <ValueTextList>from inside to outside|from outside to inside</ValueTextList>
                        <ValueTextIdList>2017|2018</ValueTextIdList>
                        <ValueList2>12283|12285</ValueList2>
                        <ValueType>PictureResourceButtonList</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>CircularSpacingRow</Name>
                        <Text>Bar spacing</Text>
                        <TextId>2019</TextId>
                        <ValueType>Row</ValueType>
                        <Value>OVERALL:1</Value>
                        <Parameters>
                            <Parameter>
                                <Name>InfoPicture</Name>
                                <Text>Define the spacing between bars, in millimeters.

• Constant spacing: 250
  Repeats a spacing of 250 mm up to the zone boundary.

• Repetitions: 150 ; 3*250 ; 500
  Applies one spacing of 150 mm, then three of 250 mm, then one of 500 mm (within the zone boundary).

Spacings follow the selected distribution direction and must be strictly positive.</Text>
                                <TextId>2020</TextId>
                                <Value>AllplanSettings.PictResPalette.eHotinfo</Value>
                                <ValueType>Picture</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>CircularBarSpacing</Name>
                                <Text> </Text>
                                <Value>250</Value>
                                <ValueType>String</ValueType>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>DistributionCheckBox</Name>
                        <Text>Enable distribution</Text>
                        <TextId>2021</TextId>
                        <Value>False</Value>
                        <ValueType>CheckBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>DistribTypeRadioGroup</Name>
                        <Text>By</Text>
                        <TextId>2022</TextId>
                        <Value>1</Value>
                        <ValueType>RadioButtonGroup</ValueType>
                        <Visible>DistributionCheckBox</Visible>
                        <Parameters>
                            <Parameter>
                                <Name>DistribTypeValue0</Name>
                                <Text>Count</Text>
                                <TextId>2023</TextId>
                                <Value>0</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>DistribTypeValue1</Name>
                                <Text>Spacing</Text>
                                <TextId>2024</TextId>
                                <Value>1</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>DistribCount</Name>
                        <Text>Count</Text>
                        <TextId>2025</TextId>
                        <Value>5</Value>
                        <MinValue>1</MinValue>
                        <ValueType>Integer</ValueType>
                        <Visible>DistributionCheckBox and DistribTypeRadioGroup == 0</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>DistribSpacing</Name>
                        <Text>Spacing</Text>
                        <TextId>2026</TextId>
                        <Value>250.</Value>
                        <MinValue>50</MinValue>
                        <ValueType>Length</ValueType>
                        <Visible>DistributionCheckBox and DistribTypeRadioGroup == 1</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>DistribHeight</Name>
                        <Text>Distribution height</Text>
                        <TextId>2027</TextId>
                        <Value>1000.</Value>
                        <MinValue>100.</MinValue>
                        <ValueType>Length</ValueType>
                        <Visible>DistributionCheckBox</Visible>
                    </Parameter>

                </Parameters>
            </Parameter>

        </Parameters>

    </Page>

    <Page>

        <Name>OptionsPage</Name>
        <Text>Options</Text>
        <TextId>3001</TextId>

        <Parameters>

            <Parameter>
                <Name>FormatExpander</Name>
                <Text>Format</Text>
                <TextId>3002</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>
                    <Parameter>
                        <Name>CommonProp</Name>
                        <Text>PythonPart</Text>
                        <TextId>3003</TextId>
                        <Value>CommonProperties(HelpConstruction(1))</Value>
                        <ValueType>CommonProperties</ValueType>
                        <Visible>|DrawOrder:False</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>ReinfProp</Name>
                        <Text>Reinforcement</Text>
                        <TextId>3004</TextId>
                        <Value>CommonProperties(Layer(3864))</Value>
                        <ValueType>CommonProperties</ValueType>
                        <Visible>|Color:False|Pen:False|Stroke:False|HelpConstruction:False|DrawOrder:False</Visible>
                    </Parameter>
                </Parameters>
            </Parameter>
        </Parameters>

    </Page>

</Element>