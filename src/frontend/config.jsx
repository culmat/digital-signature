import React, { useState, useEffect } from 'react';
import ForgeReconciler, { useConfig, Button, Label, SectionMessage, Stack, Text, Textfield, Link } from '@forge/react';
import { view } from '@forge/bridge';

const useSubmit = () => {
  const [error, setError] = useState();
  const [message, setMessage] = useState('');

  const submit = async (fields) => {
    const payload = { config: fields };

    try {
      await view.submit(payload);
      setError(false);
      setMessage(`Submitted successfully.`);
    } catch (error) {
      setError(true);
      setMessage(`${error.code}: ${error.message}`);
    }
  };

  return {
    error,
    message,
    submit
  };
};

const Config = () => {
  const [panelTitle, setPanelTitle] = useState('');
  const { error, message, submit } = useSubmit();
  const config = useConfig();

  useEffect(() => {
    setPanelTitle(config?.panelTitle || '');
  }, [config?.panelTitle]);

  return (
    <Stack space="space.200">
      <Text>Embeds a signature panel within which text may be digitally signed by one or more Confluence users.
        See <Link href="https://github.com/culmat/digital-signature/wiki/Signature-Macro-Usage">documentation</Link>
      </Text>
      <Label labelFor="panelTitle">Panel Title</Label>
      <Textfield 
        id="panelTitle" 
        value={panelTitle} 
        onChange={(e) => setPanelTitle(e.target.value)}
      />
      <Text>Text displayed at the top of the signature panel.</Text>
      <Button appearance="subtle" onClick={view.close}>
        Close
      </Button>
      <Button appearance="primary" onClick={() => submit({ panelTitle })}>
        Submit
      </Button>
      {typeof error !== 'undefined' && (
        <SectionMessage appearance={error ? 'error' : 'success'}>{message}</SectionMessage>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Config />
  </React.StrictMode>
);
