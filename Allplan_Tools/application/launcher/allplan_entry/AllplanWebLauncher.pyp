<?xml version="1.0" encoding="utf-8"?>
<Element>
  <Script>
    <Name>application\launcher\allplan_entry\AllplanWebLauncher.py</Name>
    <Title>Launcher des plugins Allplan</Title>
    <Version>1.0</Version>
  </Script>
  <Page>
    <Name>Launcher</Name>
    <Text>Plugins Allplan</Text>
    <Parameters>
      <Parameter>
        <Name>InstallationType</Name>
        <Text>Type (API sans detection fiable)</Text>
        <Value>Choisir</Value>
        <ValueList>Choisir|Standard|Verification</ValueList>
        <ValueType>StringComboBox</ValueType>
      </Parameter>
      <Parameter>
        <Name>LaunchRow</Name>
        <Text>Applications</Text>
        <ValueType>Row</ValueType>
        <Parameters>
          <Parameter>
            <Name>Launch</Name>
            <Text>Ouvrir le launcher</Text>
            <EventId>1001</EventId>
            <ValueType>Button</ValueType>
          </Parameter>
        </Parameters>
      </Parameter>
    </Parameters>
  </Page>
</Element>
