import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useConfig, Box, Heading, Text, List, ListItem, Checkbox, Stack, xcss } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [data, setData] = useState(null);

  const config = useConfig();
  
  const panelTitle = config?.panelTitle || '';

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
        <Text>
          This is the signature panel content. Users can digitally sign documents here.
        </Text>
        
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
