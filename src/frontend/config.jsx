import React, { useState, useEffect } from 'react';
import ForgeReconciler, { useConfig, useTranslation, I18nProvider, Button, Label, SectionMessage, Stack, Text, Textfield, Link, UserPicker, Checkbox, TextArea, RadioGroup, ErrorMessage } from '@forge/react';
import { view } from '@forge/bridge';

// Simple parameter interpolation for translation strings with {variable} placeholders.
// Forge's t() only supports (key, defaultValue) — it does not interpolate parameters.
const interpolate = (str, params) => {
  let result = str;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
};

const useSubmit = () => {
  const { t } = useTranslation();
  const [error, setError] = useState();
  const [message, setMessage] = useState('');

  const submit = async (fields) => {
    const payload = { config: fields };

    try {
      await view.submit(payload);
      setError(false);
      setMessage(t('success.config_saved'));
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
  const { ready, t } = useTranslation();

  // Wrapper: translate key then interpolate {variable} placeholders
  const tp = (key, params) => interpolate(t(key), params);
  // Panel title state
  const [title, setTitle] = useState('');

  // Contract content state (markdown)
  const [content, setContent] = useState('');

  // Signer restriction states
  const [signers, setSigners] = useState([]);
  const [signerGroups, setSignerGroups] = useState('');
  const [inheritViewers, setInheritViewers] = useState(false);
  const [inheritEditors, setInheritEditors] = useState(false);
  const [maxSignatures, setMaxSignatures] = useState('');
  const [visibilityLimit, setVisibilityLimit] = useState('');
  const [signaturesVisible, setSignaturesVisible] = useState('ALWAYS');
  const [pendingVisible, setPendingVisible] = useState('ALWAYS');
  
  const { error, message, submit } = useSubmit();
  const config = useConfig();

  // Initialize form fields from existing config
  useEffect(() => {
    setTitle(config?.title || '');
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
    setVisibilityLimit(config?.visibilityLimit !== undefined ? String(config.visibilityLimit) : '');
    setSignaturesVisible(config?.signaturesVisible || 'ALWAYS');
    setPendingVisible(config?.pendingVisible || 'ALWAYS');
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

  // Title validation: max 200 characters
  const TITLE_MAX_LENGTH = 200;
  const titleTooLong = title.length > TITLE_MAX_LENGTH;

  // Handle form submission
  const handleSubmit = () => {
    if (titleTooLong) return;
    // Parse signerGroups from textarea (one ID per line)
    const groupIds = signerGroups
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // Parse maxSignatures (empty = undefined for unlimited)
    const maxSigs = maxSignatures.trim() === '' ? undefined : parseInt(maxSignatures, 10);
    
    // Parse visibilityLimit (empty = undefined for unlimited)
    const visLimit = visibilityLimit.trim() === '' ? undefined : parseInt(visibilityLimit, 10);
    
    // Extract just the account IDs from signers
    // UserPicker onChange returns array of user objects when selecting,
    // but might already be strings if loaded from config
    const signerIds = signers.map(signer => 
      typeof signer === 'string' ? signer : signer.id
    );
    
    submit({
      title,
      content,
      signers: signerIds,
      signerGroups: groupIds,
      inheritViewers,
      inheritEditors,
      maxSignatures: maxSigs,
      visibilityLimit: visLimit,
      signaturesVisible,
      pendingVisible,
    });
  };

  // Wait for translations to be ready before rendering
  if (!ready) return null;

  return (
    <Stack space="space.200">
      <Text>
        {t('config.description_prefix')}<Link href="https://github.com/culmat/digital-signature/wiki/Signature-Macro-Usage">{t('config.documentation_link')}</Link>{t('config.description_suffix')}
      </Text>

      {/* Contract Title */}
      <Label labelFor="title">{t('config.fields.title.label')}</Label>
      <Textfield
        id="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {titleTooLong
        ? <ErrorMessage>{tp('config.fields.title.too_long', { max: TITLE_MAX_LENGTH, current: title.length })}</ErrorMessage>
        : <Text>{t('config.fields.title.description')}</Text>
      }

      {/* Contract Content (Markdown) */}
      <Label labelFor="content">{t('config.fields.content.label')}</Label>
      <TextArea
        id="content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('config.fields.content.placeholder')}
        minimumRows={15}
        resize="vertical"
        isMonospaced={true}
      />
      <Text>{t('config.fields.content.description')}</Text>

      {/* Named Signers */}
      <Label labelFor="signers">{t('config.fields.signers.label')}</Label>
      <UserPicker
        key={`user-picker-${signers.join(',')}`}
        id="signers"
        name="signers"
        isMulti={true}
        defaultValue={signers}
        onChange={handleSignersChange}
      />
      <Text>{t('config.fields.signers.description')}</Text>
      
      {/* Signer Groups */}
      <Label labelFor="signerGroups">{t('config.fields.signer_groups.label')}</Label>
      <TextArea
        id="signerGroups"
        value={signerGroups}
        onChange={(e) => setSignerGroups(e.target.value)}
        placeholder={t('config.fields.signer_groups.placeholder')}
        rows={3}
      />
      <Text>{t('config.fields.signer_groups.description')}</Text>
      
      {/* Inherit from Page Permissions */}
      <Checkbox
        id="inheritViewers"
        label={t('config.fields.inherit_viewers.label')}
        isChecked={inheritViewers}
        onChange={(e) => setInheritViewers(e.target.checked)}
      />
      
      <Checkbox
        id="inheritEditors"
        label={t('config.fields.inherit_editors.label')}
        isChecked={inheritEditors}
        onChange={(e) => setInheritEditors(e.target.checked)}
      />
      
      {/* Max Signatures */}
      <Label labelFor="maxSignatures">{t('config.fields.max_signatures.label')}</Label>
      <Textfield
        id="maxSignatures"
        type="number"
        value={maxSignatures}
        onChange={(e) => setMaxSignatures(e.target.value)}
        placeholder={t('config.fields.max_signatures.placeholder')}
      />
      <Text>{t('config.fields.max_signatures.description')}</Text>
      
      {/* Visibility Limit */}
      <Label labelFor="visibilityLimit">{t('config.fields.visibility_limit.label')}</Label>
      <Textfield
        id="visibilityLimit"
        type="number"
        value={visibilityLimit}
        onChange={(e) => setVisibilityLimit(e.target.value)}
        placeholder={t('config.fields.visibility_limit.placeholder')}
      />
      <Text>{t('config.fields.visibility_limit.description')}</Text>

      {/* Signatures Visibility */}
      <Label labelFor="signaturesVisible">{t('config.visibility_settings_signatures')}</Label>
      <RadioGroup
        name="signaturesVisible"
        value={signaturesVisible}
        onChange={(e) => setSignaturesVisible(e.target.value)}
        options={[
          { label: t('config.fields.signatures_visible.options.always'), value: 'ALWAYS' },
          { label: t('config.fields.signatures_visible.options.signatory'), value: 'IF_SIGNATORY' },
          { label: t('config.fields.signatures_visible.options.signed'), value: 'IF_SIGNED' },
        ]}
      />
      <Text>{t('config.visibility_description_signatures')}</Text>

      {/* Pending Signatures Visibility */}
      <Label labelFor="pendingVisible">{t('config.visibility_settings_pending')}</Label>
      <RadioGroup
        name="pendingVisible"
        value={pendingVisible}
        onChange={(e) => setPendingVisible(e.target.value)}
        options={[
          { label: t('config.fields.pending_visible.options.always'), value: 'ALWAYS' },
          { label: t('config.fields.pending_visible.options.signatory'), value: 'IF_SIGNATORY' },
          { label: t('config.fields.pending_visible.options.signed'), value: 'IF_SIGNED' },
        ]}
      />
      <Text>{t('config.visibility_description_pending')}</Text>

      {/* Petition Mode Warning */}
      {isPetitionMode && (
        <SectionMessage appearance="warning" title={t('config.petition_mode.title')}>
          <Text>{t('config.petition_mode.description')}</Text>
        </SectionMessage>
      )}
      
      {/* Action Buttons */}
      <Button appearance="subtle" onClick={view.close}>
        {t('ui.button.close')}
      </Button>
      <Button appearance="primary" onClick={handleSubmit}>
        {t('config.button.submit')}
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
    <I18nProvider>
      <Config />
    </I18nProvider>
  </React.StrictMode>
);
