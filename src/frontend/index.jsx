import React, { useEffect, useState, useMemo, useReducer, useCallback } from 'react';
import ForgeReconciler, { useConfig, useProductContext, useTranslation, I18nProvider, Box, Heading, Text, Button, Checkbox, Stack, SectionMessage, Strong, Spinner, xcss, User, Inline, Lozenge, Popup, Modal, ModalTransition, ModalHeader, ModalTitle, ModalBody, ModalFooter, ButtonGroup, TextArea } from '@forge/react';
import { parseAndSanitize, validateMarkdownContent } from '../shared/markdown/parseAndSanitize';
import { MarkdownContent } from './markdown/renderToReact';
import { isSectionVisible } from '../shared/visibilityCheck';

const Signatures = ({ signatures, label, formatDate }) => {
  return (
    <Box>
      <Heading size="small">{label} ({signatures.length})</Heading>
      <Stack space="space.100">
        {signatures.map((sig) => {
          // If sig is an object with accountId, treat as signed; if string, treat as pending
          if (typeof sig === 'string') {
            return <SignatureUser key={sig} accountId={sig} />;
          } else {
            return <SignatureUser key={sig.accountId} accountId={sig.accountId} date={formatDate(sig.signedAt)} />;
          }
        })}
      </Stack>
    </Box>
  );
};

// Custom component to render a signature user with optional date and checkbox
const SignatureUser = ({ accountId, date }) => {
  return (
    <Inline space="space.100">
      <Checkbox
        isChecked={!!date}
        isDisabled
        label=""
      />
      <Text>
        <User accountId={accountId} />
        {date ? <> – <Lozenge>{date}</Lozenge></> : null}
      </Text>
    </Inline>
  );
};
import { invoke, view, router } from '@forge/bridge';
import { signDocument, getSignatures, checkAuthorization } from './utils/signatureClient';

const DEFAULT_LOCALE = 'en-GB';

function signatureReducer(state, action) {
  switch (action.type) {
    case 'SET_ENTITY':
      return { ...state, entity: action.payload, isLoading: false };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_HASH':
      return { ...state, contentHash: action.payload };
    case 'UPDATE_AFTER_SIGN':
      return { ...state, entity: action.payload, isLoading: false };
    default:
      return state;
  }
}

function authReducer(state, action) {
  switch (action.type) {
    case 'SET_CHECKING':
      return { ...state, isChecking: action.payload };
    case 'SET_STATUS':
      return { ...state, status: action.payload, isChecking: false };
    case 'CLEAR_STATUS':
      return { ...state, status: null, isChecking: false };
    default:
      return state;
  }
}

function useContentContext(context) {
  const pageId = context?.extension?.content?.id;
  const spaceKey = context?.extension?.space?.key;

  return useMemo(() => ({
    pageId,
    spaceKey,
  }), [pageId, spaceKey]);
}

// Simple parameter interpolation for translation strings with {variable} placeholders.
// Forge's t() only supports (key, defaultValue) — it does not interpolate parameters.
const interpolate = (str, params) => {
  let result = str;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
};

const App = () => {
  const { ready, t } = useTranslation();

  // Wrapper: translate key then interpolate {variable} placeholders
  const tp = (key, params) => interpolate(t(key), params);
  const [signatureState, dispatchSignature] = useReducer(signatureReducer, {
    entity: null,
    isLoading: true,
    contentHash: null,
  });

  const [authState, dispatchAuth] = useReducer(authReducer, {
    status: null,
    isChecking: false,
  });

  const [userState, setUserState] = useState({
    accountId: null,
    locale: DEFAULT_LOCALE,
  });

  const [uiState, setUIState] = useState({
    isSigning: false,
    actionError: null,
  });

  const [showAllSigned, setShowAllSigned] = useState(false);
  const [emailPopupOpen, setEmailPopupOpen] = useState(false);
  const [emailModal, setEmailModal] = useState({ isOpen: false, emails: [], title: '' });
  const [emailLoading, setEmailLoading] = useState(false);

  const config = useConfig();
  const context = useProductContext();
  const { pageId } = useContentContext(context);

  const title = config?.title || '';
  const content = config?.content || '';
  const configuredSigners = config?.signers || [];
  const visibilityLimit = config?.visibilityLimit;
  const signaturesVisible = config?.signaturesVisible;
  const pendingVisible = config?.pendingVisible;

  // Parse markdown content to AST for rendering
  const ast = useMemo(() => parseAndSanitize(content), [content]);

  // Validate content
  const validationWarning = validateMarkdownContent(content);
  
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

  // Load current user's accountId on mount using view.getContext()
  useEffect(() => {
    async function fetchUser() {
      try {
        const context = await view.getContext();
        setUserState({
          accountId: context.accountId,
          locale: context.locale || DEFAULT_LOCALE,
        });
      } catch (error) {
        console.error('Error loading current user:', error);
      }
    }
    fetchUser();
  }, []);

  // Load signatures on mount and whenever content changes
  useEffect(() => {
    const loadSignatures = async () => {
      // Only load if we have valid content (passed validation)
      if (!content || validationWarning) {
        dispatchSignature({ type: 'SET_LOADING', payload: false });
        return;
      }

      try {
        dispatchSignature({ type: 'SET_LOADING', payload: true });

        if (!pageId) {
          console.error('No page ID found in context');
          dispatchSignature({ type: 'SET_LOADING', payload: false });
          return;
        }

        // Fetch signatures using the client helper (computes hash internally)
        const result = await getSignatures(
          invoke,
          pageId,
          title,
          content
        );

        if (result.success) {
          dispatchSignature({ type: 'SET_ENTITY', payload: result.signature });
          dispatchSignature({ type: 'SET_HASH', payload: result.hash });
        } else {
          console.error('Failed to load signatures:', result.error);
        }
      } catch (error) {
        console.error('Error loading signatures:', error);
      } finally {
        dispatchSignature({ type: 'SET_LOADING', payload: false });
      }
    };

    loadSignatures();
  }, [content, pageId, title, validationWarning]);

  useEffect(() => {
    const checkAuth = async () => {
      if (!content || validationWarning || !userState.accountId || !pageId) {
        dispatchAuth({ type: 'CLEAR_STATUS' });
        return;
      }

      try {
        dispatchAuth({ type: 'SET_CHECKING', payload: true });

        const result = await checkAuthorization(
          invoke,
          pageId,
          title,
          content
        );

        if (result.success) {
          dispatchAuth({
            type: 'SET_STATUS',
            payload: {
              allowed: result.allowed,
              reason: result.reason
            }
          });
        } else {
          console.error('Failed to check authorization:', result.error);
          dispatchAuth({ type: 'CLEAR_STATUS' });
        }
      } catch (error) {
        console.error('Error checking authorization:', error);
        dispatchAuth({ type: 'CLEAR_STATUS' });
      }
    };

    checkAuth();
  }, [signatureState.entity, content, title, userState.accountId, pageId, validationWarning]);

  const handleSign = async () => {
    try {
      setUIState(prev => ({ ...prev, isSigning: true, actionError: null }));

      if (!pageId || !content) {
        setUIState(prev => ({ ...prev, isSigning: false, actionError: { key: 'error.missing_fields', params: { fields: 'pageId, content' } } }));
        return;
      }

      // Sign using the client helper (computes hash internally)
      const result = await signDocument(
        invoke,
        pageId,
        title,
        content
      );

      if (result.success) {
        dispatchSignature({ type: 'UPDATE_AFTER_SIGN', payload: result.signature });
        console.log(result.message);

        const authResult = await checkAuthorization(invoke, pageId, title, content);
        if (authResult.success) {
          dispatchAuth({
            type: 'SET_STATUS',
            payload: {
              allowed: authResult.allowed,
              reason: authResult.reason
            }
          });
        }
        setUIState(prev => ({ ...prev, isSigning: false, actionError: null }));
      } else {
        setUIState(prev => ({ ...prev, isSigning: false, actionError: result.error || 'error.generic' }));
        console.error('Failed to sign:', result.error);
      }
    } catch (error) {
      setUIState(prev => ({ ...prev, isSigning: false, actionError: error.message || 'error.generic' }));
      console.error('Error signing:', error);
    }
  };

  const formatDate = (timestamp) => {
    // Handle Date objects, ISO strings, or Unix timestamps
    let date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else if (typeof timestamp === 'number') {
      // Assume Unix timestamp in seconds, convert to milliseconds
      date = new Date(timestamp * 1000);
    } else {
      return t('ui.status.invalid_date');
    }

    const formatter = new Intl.DateTimeFormat(userState.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(date);
  };

  // Calculate pending signatures (Phase 1: Named signers only)
  const calculatePendingSignatures = () => {
    // If no configured signers, petition mode - anyone can sign
    if (configuredSigners.length === 0) {
      return [];
    }

    const signedAccountIds = new Set(
      (signatureState.entity?.signatures || []).map(sig => sig.accountId)
    );

    // Pending = configured signers minus those who already signed
    return configuredSigners.filter(accountId => !signedAccountIds.has(accountId));
  };

  const pendingSignatures = calculatePendingSignatures();
  const hasPendingSignatures = pendingSignatures.length > 0;
  const hasSignatures = signatureState.entity?.signatures?.length > 0;

  // Visibility controls: determine if current user can see signed/pending sections
  const hasSigned = signatureState.entity?.signatures?.some(
    sig => sig.accountId === userState.accountId
  ) ?? false;
  // authState.status.allowed becomes false after signing, but user is still a signatory
  const isSignatory = authState.status?.allowed || hasSigned;
  const showSignedSection = isSectionVisible(signaturesVisible, { isSignatory, hasSigned });
  const showPendingSection = isSectionVisible(pendingVisible, { isSignatory, hasSigned });

  const handleEmailAction = useCallback(async (accountIds, label) => {
    setEmailPopupOpen(false);
    setEmailLoading(true);
    try {
      const result = await invoke('getEmailAddresses', {
        accountIds,
        subject: title || 'Digital Signature',
      });

      if (!result.success) {
        console.error('Failed to fetch emails:', result.error);
        return;
      }

      // If mailto URL fits, open it directly
      if (result.mailto) {
        router.open(result.mailto);
        return;
      }

      // Otherwise show modal with email list
      const emails = (result.users || [])
        .filter(u => u.email)
        .map(u => u.email);

      setEmailModal({ isOpen: true, emails, title: label });
    } catch (error) {
      console.error('Error fetching email addresses:', error);
    } finally {
      setEmailLoading(false);
    }
  }, [title]);

  const handleEmailSigned = useCallback(() => {
    const signedIds = (signatureState.entity?.signatures || []).map(s => s.accountId);
    handleEmailAction(signedIds, t('ui.heading.signed'));
  }, [signatureState.entity, handleEmailAction, t]);

  const handleEmailPending = useCallback(() => {
    handleEmailAction(pendingSignatures, t('ui.heading.pending'));
  }, [pendingSignatures, handleEmailAction, t]);

  const closeEmailModal = useCallback(() => {
    setEmailModal({ isOpen: false, emails: [], title: '' });
  }, []);

  // Wait for translations to be ready before rendering
  if (!ready) return null;

  // Wait for config to load before rendering anything
  if (!config) {
    return <Spinner />;
  }

  // If validation fails (insufficient content), show warning instead of the macro
  if (validationWarning) {
    return (
      <SectionMessage
        appearance="warning"
        title={t('macro.validation.cannot_use')}
      >
        <Stack space="space.100">
          <Text>
            <Strong>{validationWarning.contentType}:</Strong> {validationWarning.contentDetails}
          </Text>
          <Text>
            {validationWarning.message}
          </Text>
          <Text>
            {t('macro.validation.add_complete_text')}
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
      <Box xcss={headerStyles}>
        <Inline spread="space-between" alignBlock="center">
          <Heading size="small">{title}</Heading>
          {(hasSignatures || hasPendingSignatures) && (
            <Popup
              isOpen={emailPopupOpen}
              onClose={() => setEmailPopupOpen(false)}
              placement="bottom-end"
              content={() => (
                <Box xcss={xcss({ padding: 'space.100' })}>
                  <Stack space="space.050" alignInline="start">
                    {hasSignatures && (
                      <Button
                        appearance="subtle"
                        onClick={handleEmailSigned}
                        isDisabled={emailLoading}
                      >
                        {t('ui.button.email_signed')}
                      </Button>
                    )}
                    {hasPendingSignatures && (
                      <Button
                        appearance="subtle"
                        onClick={handleEmailPending}
                        isDisabled={emailLoading}
                      >
                        {t('ui.button.email_pending')}
                      </Button>
                    )}
                  </Stack>
                </Box>
              )}
              trigger={() => (
                <Button
                  appearance="subtle"
                  iconBefore="email"
                  onClick={() => setEmailPopupOpen(!emailPopupOpen)}
                  isDisabled={emailLoading}
                />
              )}
            />
          )}
        </Inline>
      </Box>
      
      {/* Panel Content */}
      <Box xcss={contentWrapperStyles}>
        <Stack space="space.200">
          {/* Render the markdown content if it exists */}
          {content ? (
            <MarkdownContent ast={ast} />
          ) : (
            <Text>
              {t('macro.no_content')}
            </Text>
          )}
          
          {/* Signature section */}
          {/* When IF_SIGNATORY visibility is configured, wait for auth to resolve before rendering
              to prevent sections from flashing before the auth check determines signatory status */}
          {signatureState.isLoading || (
            (signaturesVisible === 'IF_SIGNATORY' || pendingVisible === 'IF_SIGNATORY')
            && authState.status === null
          ) ? (
            <Spinner />
          ) : (
            <Stack space="space.200">
              {/* Signed signatures section */}
              {showSignedSection && signatureState.entity?.signatures && signatureState.entity.signatures.length > 0 && (
                <Stack space="space.100">
                  <Signatures
                    signatures={
                      visibilityLimit != null && !showAllSigned
                        ? signatureState.entity.signatures.slice(0, visibilityLimit)
                        : signatureState.entity.signatures
                    }
                    label={t('ui.heading.signed')} 
                    formatDate={formatDate} 
                  />
                  {visibilityLimit != null && signatureState.entity.signatures.length > visibilityLimit && !showAllSigned && (
                    <Button 
                      appearance="link" 
                      onClick={() => setShowAllSigned(true)}
                    >
                      {tp('macro.show_more', { count: signatureState.entity.signatures.length - visibilityLimit })}
                    </Button>
                  )}
                </Stack>
              )}

              {/* Pending signatures section */}
              {showPendingSection && hasPendingSignatures && (
                <Signatures signatures={pendingSignatures} label={t('ui.heading.pending')}/>
              )}
              
              {uiState.actionError && (
                <SectionMessage appearance="error">
                  <Text>
                    {typeof uiState.actionError === 'string'
                      ? t(uiState.actionError)
                      : (uiState.actionError.key && uiState.actionError.params ? tp(uiState.actionError.key, uiState.actionError.params) : t(uiState.actionError.key || 'error.generic'))}
                  </Text>
                </SectionMessage>
              )}

              {/* Sign button - show only if authorized */}
              {content && userState.accountId && authState.status?.allowed && (
                <Button
                  onClick={handleSign}
                  isDisabled={uiState.isSigning || authState.isChecking}
                  appearance="primary"
                >
                  {uiState.isSigning ? t('ui.button.signing') : t('ui.button.sign')}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>

      {/* Email addresses modal — shown when mailto URL would be too long */}
      <ModalTransition>
        {emailModal.isOpen && (
          <Modal onClose={closeEmailModal}>
            <ModalHeader>
              <ModalTitle>{emailModal.title} — {t('macro.email_modal.title_suffix')}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <TextArea
                  value={emailModal.emails.join(', ')}
                  isReadOnly
                  minimumRows={4}
                />
                <Text>{tp('macro.email_modal.count', { count: emailModal.emails.length })}</Text>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup>
                <Button
                  appearance="primary"
                  onClick={() => {
                    router.open(`mailto:${emailModal.emails.join(',')}?subject=${encodeURIComponent(title || t('app.title'))}`);
                  }}
                >
                  {t('ui.button.open_email_client')}
                </Button>
                <Button appearance="subtle" onClick={closeEmailModal}>
                  {t('ui.button.close')}
                </Button>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Box>
  );
};
ForgeReconciler.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
