<?xml version="1.0" encoding="utf-8"?>

<Element xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'
    xsi:noNamespaceSchemaLocation='https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd'>

    <LanguageFile>CircularReinforcement</LanguageFile>

    <Script>
        <Name>allplan_france\CircularReinforcement\__init__.py</Name>
        <Title>Circular Reinforcement Helper</Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
    </Script>

    <Page>

        <Name>GlobalPage</Name>
        <Text>Global</Text>
        <TextId>2001</TextId>

        <Parameters>

            <Parameter>
                <Name>CreateAsPythonPart</Name>
                <Text>Create as pythonpart?</Text>
                <TextId>2002</TextId>
                <Value>True</Value>
                <ValueType>CheckBox</ValueType>
            </Parameter>

            <Parameter>
                <Name>NameExpander</Name>
                <Text>Name</Text>
                <TextId>2003</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>ZoneName</Name>
                        <Text>Name</Text>
                        <TextId>2004</TextId>
                        <Value>Zone name</Value>
                        <ValueType>String</ValueType>
                    </Parameter>
                </Parameters>
            </Parameter>

            <Parameter>
                <Name>GeometryExpander</Name>
                <Text>Geometry</Text>
                <TextId>2005</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>InnerRadius</Name>
                        <Text>Inner radius</Text>
                        <TextId>2006</TextId>
                        <Value>5000</Value>
                        <ValueType>Length</ValueType>
                        <MinValue>100</MinValue>
                    </Parameter>

                    <Parameter>
                        <Name>OuterRadius</Name>
                        <Text>Outer radius</Text>
                        <TextId>2007</TextId>
                        <Value>20000</Value>
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
                        <TextId>2008</TextId>
                        <Value>45</Value>
                        <ValueType>Angle</ValueType>
                        <MinValue>0</MinValue>
                        <MaxValue>360</MaxValue>
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
                        <Value>50</Value>
                        <ValueType>ReinfConcreteCover</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>FormRadioGroup</Name>
                        <Text>Form</Text>
                        <TextId>2011</TextId>
                        <Value>A</Value>
                        <ValueType>RadioButtonGroup</ValueType>
                        <Parameters>
                            <Parameter>
                                <Name>FormRadioButtonA</Name>
                                <Text>A</Text>
                                <Value>A</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>FormRadioButtonB</Name>
                                <Text>B</Text>
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
                        <TextId>2012</TextId>
                        <Value>12000</Value>
                        <ValueType>Length</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>DistributionDirection</Name>
                        <Text>Direction</Text>
                        <TextId>2013</TextId>
                        <Value>0</Value>
                        <ValueList>0|1</ValueList>
                        <ValueTextList>from inside to outside|from outside to inside</ValueTextList>
                        <ValueTextIdList>2014|2015</ValueTextIdList>
                        <ValueList2>12283|12285</ValueList2>
                        <ValueType>PictureResourceButtonList</ValueType>
                    </Parameter>

                    <Parameter>
                        <Name>CircularBarSpacing</Name>
                        <Text>Bar spacing</Text>
                        <TextId>2016</TextId>
                        <Value>250</Value>
                        <ValueType>String</ValueType>
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
                <Name>ConvertExpander</Name>
                <Text>Convert</Text>
                <TextId>3002</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>

                    <Parameter>
                        <Name>ConvertRadioGroup</Name>
                        <Text>Convert as:</Text>
                        <TextId>3003</TextId>
                        <Value>3D</Value>
                        <ValueType>RadioButtonGroup</ValueType>
                        <Parameters>
                            <Parameter>
                                <Name>TypeRadioButton2D</Name>
                                <Text>2D</Text>
                                <Value>2D</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                            <Parameter>
                                <Name>TypeRadioButton3D</Name>
                                <Text>3D</Text>
                                <Value>3D</Value>
                                <ValueType>RadioButton</ValueType>
                            </Parameter>
                        </Parameters>
                    </Parameter>

                    <Parameter>
                        <Name>Separator</Name>
                        <ValueType>Separator</ValueType>
                        <Visible>ConvertRadioGroup == '3D'</Visible>
                    </Parameter>

                    <Parameter>
                        <Name>BottomPlane</Name>
                        <Text>Bottom plane</Text>
                        <TextId>3004</TextId>
                        <Value />
                        <ValueType>PlaneReferences</ValueType>
                        <ValueDialog>BottomPlaneReferences</ValueDialog>
                        <Visible>ConvertRadioGroup == '3D'</Visible>
                    </Parameter>
                </Parameters>
            </Parameter>

            <Parameter>
                <Name>FormatExpander</Name>
                <Text>Format</Text>
                <TextId>3005</TextId>
                <ValueType>Expander</ValueType>
                <Parameters>
                    <Parameter>
                        <Name>CommonProp</Name>
                        <Text />
                        <Value />
                        <ValueType>CommonProperties</ValueType>
                    </Parameter>
                </Parameters>
            </Parameter>
        </Parameters>

    </Page>

</Element>