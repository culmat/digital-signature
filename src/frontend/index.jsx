import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useConfig, useProductContext, Box, Heading, Text, List, ListItem, Checkbox, Stack, AdfRenderer, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [data, setData] = useState(null);

  const config = useConfig();
  const context = useProductContext();
  
  const panelTitle = config?.panelTitle || '';
  const macroBody = context?.extension?.macro?.body;
  console.log('Macro body:', macroBody);
  const containerStyles = xcss({
    backgroundColor: 'elevation.surface.raised',
    boxShadow: 'elevation.shadow.raised',
    padding: 'space.200',
    borderRadius: 'border.radius',
  });

  useEffect(async () => {
    invoke('getText', { example: 'my-invoke-variable' }).then(setData);
  }, []);

  return (
    <Box 
      xcss={containerStyles}
    >
      {/* Panel Header */}
      <Box 
        backgroundColor="color.background.neutral" 
        padding="space.150"
        xcss={{ marginBottom: 'space.150' }}
      >
        <Heading size="small">{panelTitle}</Heading>
      </Box>
      
      {/* Panel Content */}
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
        <List>
          <ListItem>
            <Checkbox isChecked isDisabled label="Example Signed User - 2025-10-05" />
          </ListItem>
          <ListItem>
            <Checkbox isDisabled label="Example Unsigned User" />
          </ListItem>
        </List>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
