<?xml version="1.0" encoding="utf-8"?>

<Element
    xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'
    xsi:noNamespaceSchemaLocation='https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd'>

    <LanguageFile>SlopedArchOpening</LanguageFile>

    <Script>
        <Name>allplan_france\SlopedArchOpening\__init__.py</Name>
        <Title>Sloped opening for architectural element</Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
        <Uuid>be2eb7ca-d6bd-56a5-984b-604991154350</Uuid>
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
                            https://github.com/AllplanFr/PythonPartsFr/blob/main/PythonPartsScripts/allplan_france/SlopedArchOpening/README.md</Value>
                    </Parameter>

                </Parameters>
            </Parameter>

        </Parameters>

    </Page>

    <Page>

        <Name>__HiddenPage__</Name>
        <Text />

        <Parameters>


        </Parameters>

    </Page>

</Element>