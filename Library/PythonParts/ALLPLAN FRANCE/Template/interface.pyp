<?xml version="1.0" encoding="utf-8"?>

<Element
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:noNamespaceSchemaLocation="https://pythonparts.allplan.com/2026/schemas/PythonPart.xsd">

    <Script>
        <Name>allplan_france\Template\__init__.py</Name>
        <Title>Template_Script_Object</Title>
        <Version>1.0</Version>
    </Script>
	    

	<Constants>
	
		<Constant>
			<Name>BUTTON_1</Name>
			<Value>1000</Value>
			<ValueType>Integer</ValueType>
		</Constant>
				
	</Constants>
	
	<Page>

		<Name>Page1</Name>
		<Text>Page1</Text>
		
		<Parameters>
		
			<Parameter>
			
				<Name>top_button</Name>		
				<Text></Text>
				<ValueType>Row</ValueType>
				<Value>OVERALL</Value>
					
				<Parameters>
					
					<Parameter>
						<Name>bt_1</Name>
						<Text></Text>
						<Value>10213</Value>
						<EventId>BUTTON_1</EventId>
						<ValueType>PictureResourceButton</ValueType>		
					</Parameter>
							
				</Parameters>	
			</Parameter>
			
			<Parameter>
				<Name>Separator</Name>
				<ValueType>Separator</ValueType>
			</Parameter>

		</Parameters>
		
    </Page>
	
    <Page>

		<Name>__HiddenPage__</Name>
		
		<Parameters>
		
			<Parameter>			
				<Name>nom</Name>
				<Text>text</Text>
				<Value>True</Value>
				<ValueType>CheckBox</ValueType>				
			</Parameter>
			
		</Parameters>
			
	</Page>

</Element>