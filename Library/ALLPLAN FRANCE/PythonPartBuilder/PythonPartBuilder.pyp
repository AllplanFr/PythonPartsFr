<?xml version="1.0" encoding="utf-8"?>

<Element xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'
    xsi:noNamespaceSchemaLocation='https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd'>

    <LanguageFile>PythonPartBuilder</LanguageFile>

    <Script>
        <Name>allplan_france\PythonPartBuilder\__init__.py</Name>
        <Title>PythonPart Builder</Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
        <Interactor>True</Interactor>
    </Script>

    <Constants>
        <Constant>
            <Name>EXECUTE_SCRIPT</Name>
            <Value>1000</Value>
            <ValueType>Integer</ValueType>
        </Constant>
        <Constant>
            <Name>ADD_VARIANT</Name>
            <Value>1001</Value>
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
        <Text>Global data</Text>
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
                        <Value>https://github.com/AllplanFr/PythonPartsFr/blob/main/PythonPartsScripts/allplan_france/PythonPartBuilder/README.md</Value>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>Separator</Name>
                <ValueType>Separator</ValueType>
            </Parameter>

            <Parameter>
                <Name>OKButtonRow</Name>
                <Text />
                <ValueType>Row</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>OKPictureResourceButton</Name>
                        <EventId>EXECUTE_SCRIPT</EventId>
                        <Value>15213</Value>
                        <ValueType>PictureResourceButton</ValueType>
                        <Enable>False</Enable>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>Separator</Name>
                <ValueType>Separator</ValueType>
            </Parameter>

            <Parameter>
                <Name>PPNameString</Name>
                <Text>PythonPart name</Text>
                <TextId>2002</TextId>
                <Value>My PythonPart</Value>
                <ValueType>String</ValueType>
            </Parameter>

            <Parameter>
                <Name>GeometryExpander</Name>
                <Text>Geometry</Text>
                <TextId>2003</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>VariantRow</Name>
                        <Text />
                        <ValueType>Row</ValueType>
                        <Value>OVERALL</Value>
                        <Parameters>
                            <Parameter>
                                <Name>VariantText</Name>
                                <Text />
                                <Value>Variant 1</Value>
                                <ValueType>Text</ValueType>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>AddVariantButtonRow</Name>
                        <Text />
                        <ValueType>Row</ValueType>
                        <Parameters>
                            <Parameter>
                                <Name>AddVariantPictureResourceButton</Name>
                                <EventId>ADD_VARIANT</EventId>
                                <Value>10185</Value>
                                <ValueType>PictureResourceButton</ValueType>
                                <Enable>False</Enable>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                </Parameters>
            </Parameter>

            <Parameter>
                <Name>AttributesExpander</Name>
                <Text>Attributes</Text>
                <TextId>2004</TextId>
                <Value>True</Value>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>DynamicAttributeList</Name>
                        <Text>Attributes</Text>
                        <Value>[(0,)]</Value>
                        <ValueType>AttributeIdValue</ValueType>
                        <ValueDialog>AttributeSelection</ValueDialog>
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
                <Name>LocationExpander</Name>
                <Text>Location</Text>
                <TextId>3002</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>


                    <Parameter>
                        <Name>LocationRadioGroup</Name>
                        <Text>File location</Text>
                        <TextId>3003</TextId>
                        <Value>std</Value>
                        <ValueType>RadioButtonGroup</ValueType>
                        <Parameters>

                            <Parameter>
                                <Name>LocationValue1</Name>
                                <Text>STD</Text>
                                <TextId>3004</TextId>
                                <Value>std</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>LocationValue2</Name>
                                <Text>PRJ</Text>
                                <TextId>3005</TextId>
                                <Value>prj</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>LocationValue3</Name>
                                <Text>USR</Text>
                                <TextId>3006</TextId>
                                <Value>usr</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>

                        </Parameters>
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
                <Name>InputStep</Name>
                <Text />
                <Value>0</Value>
                <ValueType>Integer</ValueType>
                <Persistent>NO</Persistent>
            </Parameter>

        </Parameters>

    </Page>

</Element>