import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useConfig, useProductContext, Box, Heading, Text, List, ListItem, Checkbox, Stack, AdfRenderer, SectionMessage, Strong, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';
import { checkForDynamicContent } from './utils/adfValidator';

const App = () => {
  const [data, setData] = useState(null);

  const config = useConfig();
  const context = useProductContext();
  
  const panelTitle = config?.panelTitle || '';
  const macroBody = context?.extension?.macro?.body;
  console.log('Macro body:', macroBody);
  
  // Check for dynamic content in the macro body
  const dynamicContentWarning = macroBody ? checkForDynamicContent(macroBody) : null;
  
  // Styles for the container box with elevation
  const containerStyles = xcss({
    backgroundColor: 'elevation.surface.raised',
    boxShadow: 'elevation.shadow.raised',
    padding: 'space.0',
    borderRadius: 'border.radius',
    marginTop: 'space.100',
    marginBottom: 'space.100',
    borderWidth: 'border.width',
    borderStyle: 'solid',
    borderColor: 'color.border',
  });

  // Styles for the header section
  const headerStyles = xcss({
    backgroundColor: 'color.background.neutral',
    padding: 'space.150',
    borderTopLeftRadius: 'border.radius',
    borderTopRightRadius: 'border.radius',
  });

  // Styles for the content wrapper
  const contentWrapperStyles = xcss({
    padding: 'space.200',
  });

  useEffect(() => {
    invoke('getText', { example: 'my-invoke-variable' }).then(setData);
  }, []);

  // If dynamic content is detected, show warning instead of the macro
  if (dynamicContentWarning) {
    return (
      <SectionMessage 
        appearance="warning"
        title="Cannot Use for Digital Signatures"
      >
        <Stack space="space.100">
          <Text>
            <Strong>{dynamicContentWarning.contentType} Found:</Strong> {dynamicContentWarning.contentDetails}
          </Text>
          <Text>
            {dynamicContentWarning.message}
          </Text>
          <Text>
            For a legally binding digital signature, the document content must be static and unchangeable. 
            Please remove the highlighted content from the macro body.
          </Text>
        </Stack>
      </SectionMessage>
    );
  }

  return (
    <Box 
      xcss={containerStyles}
    >
      {/* Panel Header */}
      <Box 
        xcss={headerStyles}
      >
        <Heading size="small">{panelTitle}</Heading>
      </Box>
      
      {/* Panel Content */}
      <Box xcss={contentWrapperStyles}>
        <Stack space="space.200">
          {/* Render the macro body content if it exists */}
          {macroBody ? (
            <AdfRenderer document={macroBody} />
          ) : (
            <Text>
              No content added yet. Edit the macro and add content in the body.
            </Text>
          )}
          
          {/* Example signature list - this would be populated with actual signatures */}
          <Stack space="space.100">
            <Checkbox isChecked isDisabled label="Example Signed User - 2025-10-05" />
            <Checkbox isDisabled label="Example Unsigned User" />
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
};
ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
