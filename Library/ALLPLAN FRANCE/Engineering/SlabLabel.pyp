<?xml version="1.0" encoding="UTF-8"?>

<Element
    xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'
    xsi:noNamespaceSchemaLocation='https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd'>

    <LanguageFile>SlabLabel</LanguageFile>

    <Script>
        <Name>allplan_france\Engineering\SlabLabel\__init__.py</Name>
        <Title>Slab label</Title>
        <TextId>1001</TextId>
        <AttributeEvent>True</AttributeEvent>
        <MoveEvent>True</MoveEvent>
        <Version>1.0</Version>
        <Uuid>5d51616c-2eb5-53bb-b4d3-6ab75dec660f</Uuid>
    </Script>

    <Constants>
        <Constant>
            <Name>R0T_Z_MINUS</Name>
            <Value>1005</Value>
            <ValueType>Integer</ValueType>
        </Constant>
        <Constant>
            <Name>R0T_Z_PLUS</Name>
            <Value>1006</Value>
            <ValueType>Integer</ValueType>
        </Constant>
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
                            https://github.com/AllplanFr/PythonPartsFr/blob/main/PythonPartsScripts/allplan_france/Engineering/SlabLabel/README.md</Value>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>DisplayExpander</Name>
                <Text>Display</Text>
                <TextId>2010</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>SpanningDirection</Name>
                        <Text>Spanning</Text>
                        <TextId>2011</TextId>
                        <Value>0</Value>
                        <ValueList>0|1|2|3</ValueList>
                        <ValueTextList>none|direction 1|direction 2|both</ValueTextList>
                        <ValueList2>11873|11875|11877|11879</ValueList2>
                        <ValueType>PictureResourceComboBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>ZRotationRow</Name>
                        <Text>Rotation</Text>
                        <TextId>2012</TextId>
                        <ValueType>Row</ValueType>

                        <Parameters>

                            <Parameter>
                                <Name>BTN_Z_MINUS</Name>
                                <Text />
                                <EventId>R0T_Z_MINUS</EventId>
                                <Value>8520</Value>
                                <WidthInRow>10</WidthInRow>
                                <ValueType>PictureResourceButton</ValueType>
                            </Parameter>

                            <Parameter>
                                <Name>ZRotation</Name>
                                <Text />
                                <Value>0</Value>
                                <ValueType>Angle</ValueType>
                                <MinValue>-89</MinValue>
                                <MaxValue>89</MaxValue>
                            </Parameter>

                            <Parameter>
                                <Name>BTN_Z_PLUS</Name>
                                <Text />
                                <EventId>R0T_Z_PLUS</EventId>
                                <Value>8519</Value>
                                <WidthInRow>10</WidthInRow>
                                <ValueType>PictureResourceButton</ValueType>
                            </Parameter>

                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>LeaderLine</Name>
                        <Text>Leader line direction</Text>
                        <TextId>2013</TextId>
                        <Value>1</Value>
                        <ValueList>0|1|2</ValueList>
                        <ValueTextList>none|direction 1|direction 2</ValueTextList>
                        <ValueList2>11873|16595|16597</ValueList2>
                        <ValueType>PictureResourceComboBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>GeorefPointOffset</Name>
                        <Text>Georeferencing</Text>
                        <TextId>2014</TextId>
                        <Value>False</Value>
                        <ValueType>CheckBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>GeorefZOffset</Name>
                        <Text>Altimetry</Text>
                        <TextId>2015</TextId>
                        <Value>0</Value>
                        <ValueType>Length</ValueType>
                        <Enable>False</Enable>
                        <Visible>GeorefPointOffset</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>ThicknessUnit</Name>
                        <Text>Thickness in</Text>
                        <TextId>2016</TextId>
                        <Value>cm</Value>
                        <ValueList>cm|m</ValueList>
                        <ValueType>StringComboBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>CustomThickRow</Name>
                        <Text>Custom thickness</Text>
                        <TextId>2017</TextId>
                        <ValueType>Row</ValueType>
                        <Parameters>

                            <Parameter>
                                <Name>CustomThickCheckbox</Name>
                                <Text />
                                <Value>False</Value>
                                <ValueType>CheckBox</ValueType>

                            </Parameter>

                            <Parameter>
                                <Name>CustomThickValue</Name>
                                <Text />
                                <Value />
                                <ValueType>String</ValueType>
                                <Enable>CustomThickCheckbox</Enable>
                                <WidthInRow>40</WidthInRow>
                            </Parameter>

                            <Parameter>
                                <Name>InitThickValue</Name>
                                <Text />
                                <Value>0</Value>
                                <ValueType>String</ValueType>
                                <Enable>False</Enable>
                            </Parameter>

                            <Parameter>
                                <Name>ThickValidatePicture</Name>
                                <Text />
                                <EventId>8000</EventId>
                                <Value>16613</Value>
                                <ValueType>PictureResourceButton</ValueType>
                                <Enable>CustomThickCheckbox</Enable>
                            </Parameter>

                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>ShowFinishedFloorLevel</Name>
                        <Text>Show finished floor level</Text>
                        <TextId>2018</TextId>
                        <Value>True</Value>
                        <ValueType>CheckBox</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>ShowLoadClass</Name>
                        <Text>Show load class</Text>
                        <TextId>2019</TextId>
                        <Value>True</Value>
                        <ValueType>CheckBox</ValueType>
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
                <Name>ForamatExpander</Name>
                <Text>Format</Text>
                <TextId>3010</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>LabelCommonProp</Name>
                        <Text />
                        <Value>CommonProperties(Layer(3746))</Value>
                        <ValueType>CommonProperties</ValueType>
                        <Visible>|DrawOrder:False</Visible>
                    </Parameter>

                </Parameters>
            </Parameter>

        </Parameters>

    </Page>

    <Page>

        <Name>__HiddenPage__</Name>
        <Text />

        <Parameters>

            <Parameter>
                <Name>SourceElementHash</Name>
                <Value />
                <ValueType>String</ValueType>
            </Parameter>

            <Parameter>
                <Name>GravityPoint</Name>
                <Text />
                <Value>Point3D(0,0,0)</Value>
                <ValueType>Point3D</ValueType>
            </Parameter>

            <Parameter>
                <Name>InputPoint</Name>
                <Text />
                <Value>Point3D(0,0,0)</Value>
                <ValueType>Point3D</ValueType>
            </Parameter>

            <Parameter>
                <Name>VectorOffset</Name>
                <Text />
                <Value>Vector3D(0,0,0)</Value>
                <ValueType>Vector3D</ValueType>
            </Parameter>

            <Parameter>
                <Name>TimeStamp</Name>
                <Text />
                <Value>0</Value>
                <ValueType>Integer</ValueType>
            </Parameter>

        </Parameters>

    </Page>

</Element>