import React, { useState, useEffect } from 'react';
import ForgeReconciler, { useConfig, Button, Label, SectionMessage, Stack, Text, Textfield, Link, UserPicker, Checkbox, TextArea } from '@forge/react';
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
  // Panel title state
  const [panelTitle, setPanelTitle] = useState('');

  // Contract content state (markdown)
  const [content, setContent] = useState('');

  // Signer restriction states
  const [signers, setSigners] = useState([]);
  const [signerGroups, setSignerGroups] = useState('');
  const [inheritViewers, setInheritViewers] = useState(false);
  const [inheritEditors, setInheritEditors] = useState(false);
  const [maxSignatures, setMaxSignatures] = useState('');
  
  const { error, message, submit } = useSubmit();
  const config = useConfig();

  // Initialize form fields from existing config
  useEffect(() => {
    setPanelTitle(config?.panelTitle || '');
    setContent(config?.content || '');

    // Extract account IDs from signers (config stores full user objects)
    // UserPicker value should be array of strings (account IDs)
    const signerIds = (config?.signers || []).map(signer => 
      typeof signer === 'string' ? signer : signer.id
    );
    setSigners(signerIds);
    
    setSignerGroups(config?.signerGroups?.join('\n') || '');
    setInheritViewers(config?.inheritViewers || false);
    setInheritEditors(config?.inheritEditors || false);
    setMaxSignatures(config?.maxSignatures !== undefined ? String(config.maxSignatures) : '');
  }, [config]);

  // Check if petition mode is active (no restrictions)
  const isPetitionMode = signers.length === 0 && 
                         signerGroups.trim() === '' && 
                         !inheritViewers && 
                         !inheritEditors;

  // Handle UserPicker change - normalize to always store just account IDs
  const handleSignersChange = (value) => {
    const ids = (value || []).map(item => 
      typeof item === 'string' ? item : item.id
    );
    setSigners(ids);
  };

  // Handle form submission
  const handleSubmit = () => {
    // Parse signerGroups from textarea (one ID per line)
    const groupIds = signerGroups
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // Parse maxSignatures (empty = undefined for unlimited)
    const maxSigs = maxSignatures.trim() === '' ? undefined : parseInt(maxSignatures, 10);
    
    // Extract just the account IDs from signers
    // UserPicker onChange returns array of user objects when selecting,
    // but might already be strings if loaded from config
    const signerIds = signers.map(signer => 
      typeof signer === 'string' ? signer : signer.id
    );
    
    submit({
      panelTitle,
      content,
      signers: signerIds,
      signerGroups: groupIds,
      inheritViewers,
      inheritEditors,
      maxSignatures: maxSigs
    });
  };

  return (
    <Stack space="space.200">
      <Text>Embeds contract for signature by one or more Confluence users.
        See <Link href="https://github.com/culmat/digital-signature/wiki/Signature-Macro-Usage">documentation</Link>
      </Text>

      {/* Contract Title */}
      <Label labelFor="panelTitle">Contract Title</Label>
      <Textfield
        id="panelTitle"
        value={panelTitle}
        onChange={(e) => setPanelTitle(e.target.value)}
      />
      <Text>Is part of the contract. Changes remove signatures.</Text>

      {/* Contract Content (Markdown) */}
      <Label labelFor="content">Contract Content</Label>
      <TextArea
        id="content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Enter contract text here.&#10;&#10;Supports basic Markdown:&#10;# Heading&#10;**bold** *italic*&#10;- list items&#10;> blockquote&#10;```code```"
        minimumRows={15}
        resize="vertical"
        isMonospaced={true}
      />
      <Text>Plain text or limited Markdown. This is the contract content that will be signed. Changes remove signatures.</Text>

      {/* Named Signers */}
      <Label labelFor="signers">Signers</Label>
      <UserPicker
        key={`user-picker-${signers.join(',')}`}
        id="signers"
        name="signers"
        isMulti={true}
        defaultValue={signers}
        onChange={handleSignersChange}
      />
      <Text>Select specific users who can sign this contract.</Text>
      
      {/* Signer Groups */}
      <Label labelFor="signerGroups">Signer Groups (Group IDs)</Label>
      <TextArea
        id="signerGroups"
        value={signerGroups}
        onChange={(e) => setSignerGroups(e.target.value)}
        placeholder="Enter Atlassian group IDs, one per line&#10;Example: 0a89c6b3-e6dc-41af-a86b-1e012a309a30"
        rows={3}
      />
      <Text>Enter Atlassian group IDs (not team IDs), one per line. Find group IDs in Atlassian Admin.</Text>
      
      {/* Inherit from Page Permissions */}
      <Checkbox
        id="inheritViewers"
        label="Allow page viewers to sign"
        isChecked={inheritViewers}
        onChange={(e) => setInheritViewers(e.target.checked)}
      />
      
      <Checkbox
        id="inheritEditors"
        label="Allow page editors to sign"
        isChecked={inheritEditors}
        onChange={(e) => setInheritEditors(e.target.checked)}
      />
      
      {/* Max Signatures */}
      <Label labelFor="maxSignatures">Maximum Signatures (optional)</Label>
      <Textfield
        id="maxSignatures"
        type="number"
        value={maxSignatures}
        onChange={(e) => setMaxSignatures(e.target.value)}
        placeholder="Leave empty for unlimited"
      />
      <Text>Maximum number of signatures allowed. Use 0 to disable signing. Leave empty for unlimited.</Text>
      
      {/* Petition Mode Warning */}
      {isPetitionMode && (
        <SectionMessage appearance="warning" title="Petition Mode Active">
          <Text>No restrictions configured. Any logged-in user can sign this document.</Text>
        </SectionMessage>
      )}
      
      {/* Action Buttons */}
      <Button appearance="subtle" onClick={view.close}>
        Close
      </Button>
      <Button appearance="primary" onClick={handleSubmit}>
        Submit
      </Button>
      
      {/* Feedback Message */}
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
