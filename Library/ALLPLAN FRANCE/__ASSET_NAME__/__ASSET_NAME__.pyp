<?xml version="1.0" encoding="utf-8"?>

<Element xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'
    xsi:noNamespaceSchemaLocation='https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd'>

    <LanguageFile>__ASSET_NAME__</LanguageFile>

    <Script>
        <Name>allplan_france\__ASSET_NAME__\__init__.py</Name>
        <Title>	__ASSET_TITLE_EN__</Title>
        <TextId>1001</TextId>
        <Version>1.0</Version>
        <Uuid>__ASSET_UUID__</Uuid>
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
                            https://github.com/AllplanFr/PythonPartsFr/blob/main/PythonPartsScripts/allplan_france/__ASSET_NAME__/README.md</Value>
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