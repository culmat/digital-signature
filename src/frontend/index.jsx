import React, { useEffect, useState, useMemo, useReducer, useCallback } from 'react';
import ForgeReconciler, { useConfig, useProductContext, useTranslation, I18nProvider, Box, Heading, Text, Button, LoadingButton, Checkbox, Stack, SectionMessage, Strong, Spinner, xcss, User, Inline, Lozenge, Popup, Tooltip, Modal, ModalTransition, ModalHeader, ModalTitle, ModalBody, ModalFooter, TextArea, Toggle, Label } from '@forge/react';
import { parseAndSanitize, validateMarkdownContent } from '../shared/markdown/parseAndSanitize';
import { MarkdownContent } from './markdown/renderToReact';
import { isSectionVisible } from '../shared/visibilityCheck';
import { normalizeLegacyConfig } from '../shared/normalizeLegacyConfig';
import { interpolate } from './utils/i18n';

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
import { invoke, view, router, requestConfluence } from '@forge/bridge';
import { signDocument, getSignatures, checkAuthorization } from './utils/signatureClient';

const DEFAULT_LOCALE = 'en-GB';

// Module-scope styles — avoid recreating on every render
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

const headerStyles = xcss({
  backgroundColor: 'color.background.neutral',
  padding: 'space.150',
  borderTopLeftRadius: 'border.radius',
  borderTopRightRadius: 'border.radius',
});

const contentWrapperStyles = xcss({
  padding: 'space.200',
});

const popupContentStyles = xcss({
  padding: 'space.100',
});

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

// --- Page-editor "Convert" self-heal (post-CMA migrated macros) -------------------------------
// Page I/O runs through @forge/bridge `requestConfluence`, i.e. the VIEWER's own product session —
// the only principal that reaches view-restricted pages (the app's asApp/asUser server sessions
// cannot). The pure `convertStorage` resolver does the actual transform (no Confluence call → no
// 3LO consent). See src/resolvers/convertStorageResolver.js.

/** GET a page's storage body + version + title in the current viewer's session. Returns null if unreadable. */
async function fetchPageStorage(pageId) {
  const res = await requestConfluence(
    `/wiki/api/v2/pages/${pageId}?body-format=storage`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const page = await res.json();
  return {
    storage: page?.body?.storage?.value || '',
    version: page?.version?.number || 1,
    title: page?.title || '',
  };
}

/** Read storage + ask the pure resolver to convert it. Returns { body, version, title } or null if nothing to heal. */
async function fetchAndConvert(pageId, envId) {
  const page = await fetchPageStorage(pageId);
  if (!page || !page.storage) return null;
  const result = await invoke('convertStorage', { storage: page.storage, envId });
  if (!result?.success || !result.converted) return null;
  return { body: result.body, version: page.version, title: page.title, macroCount: result.macroCount || 0 };
}

/** PUT converted storage back with version+1 (v2 optimistic-concurrency contract). Returns the raw Response. */
function putPageStorage(pageId, pageTitle, body, version) {
  return requestConfluence(`/wiki/api/v2/pages/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: String(pageId),
      status: 'current',
      title: pageTitle,
      body: { representation: 'storage', value: body },
      version: { number: (version || 0) + 1, message: 'Digital Signature: convert legacy macro' },
    }),
  });
}

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

  // null = context not yet loaded, true = licensed (or non-production env), false = inactive in production
  const [licensed, setLicensed] = useState(null);

  // Forge environment id (from view.getContext) — needed to build the target extension key when
  // healing a migrated macro. Sourced on the frontend, exactly as the admin/space migration tools do.
  const [envId, setEnvId] = useState(null);

  // Page-editor "Convert" state. `available` flips true only once we've confirmed (via the pure
  // convertStorage resolver) that this page holds an unconverted legacy macro to heal.
  const [convertState, setConvertState] = useState({
    available: false,
    body: null,
    version: null,
    title: null,
    macroCount: 0,
    isConverting: false,
    error: null,
  });

  const [uiState, setUIState] = useState({
    isSigning: false,
    actionError: null,
  });

  const [showAllSigned, setShowAllSigned] = useState(false);
  const [signSuccess, setSignSuccess] = useState(null);
  const [emailPopupOpen, setEmailPopupOpen] = useState(false);
  const [emailModal, setEmailModal] = useState({ isOpen: false, emails: [], title: '' });
  const [emailSeparator, setEmailSeparator] = useState(','); // ',' or ';'
  const [emailLoading, setEmailLoading] = useState(false);

  const config = normalizeLegacyConfig(useConfig());
  const context = useProductContext();
  const { pageId } = useContentContext(context);

  const title = config?.title || '';
  const content = config?.content || '';
  const visibilityLimit = config?.visibilityLimit;
  const signaturesVisible = config?.signaturesVisible;
  const pendingVisible = config?.pendingVisible;

  // Async state for pending signers — resolved server-side to include groups and
  // page permissions (inheritViewers / inheritEditors), not just named signers.
  const [pendingState, setPendingState] = useState({ accountIds: [], isLoading: false });

  // Parse markdown content to AST for rendering
  const ast = useMemo(() => parseAndSanitize(content), [content]);

  // Validate content
  const validationWarning = validateMarkdownContent(content);
  
  // Load current user's accountId on mount using view.getContext()
  useEffect(() => {
    async function fetchUser() {
      try {
        const context = await view.getContext();
        setUserState({
          accountId: context.accountId,
          locale: context.locale || DEFAULT_LOCALE,
        });
        setEnvId(context.environmentId || null);
        // Forge always returns license: null in dev/staging — the --license flag has no effect
        // on view.getContext(). Only enforce in production where Atlassian Marketplace injects
        // { active: true } for valid/trial licenses, or null/{ active: false } for inactive.
        setLicensed(
          context.environmentType !== 'PRODUCTION' || context.license?.active === true
        );
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

        const signatureCount = result.signature?.signatures?.length || 0;
        setSignSuccess(tp('success.signed', { count: signatureCount }));
        setTimeout(() => setSignSuccess(null), 5000);

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

  // Detect an unconverted (post-CMA) legacy macro on this page. Runs ONLY in the empty/validation-warning
  // state (a healthy converted macro has content, so this never fires for it). Reads the page storage in
  // the viewer's own session — reaching restricted pages — and asks the pure resolver whether there's
  // anything to heal. No write happens here; it only reveals the Convert button.
  useEffect(() => {
    let cancelled = false;
    async function detectLegacy() {
      if (!validationWarning || !pageId || !envId) return;
      try {
        const healed = await fetchAndConvert(pageId, envId);
        if (cancelled || !healed) return;
        setConvertState({
          available: true,
          body: healed.body,
          version: healed.version,
          title: healed.title,
          macroCount: healed.macroCount,
          isConverting: false,
          error: null,
        });
      } catch (error) {
        // Best-effort detection — on any failure just fall back to the plain warning.
        console.warn('Convert detection failed:', error?.message || error);
      }
    }
    detectLegacy();
    return () => { cancelled = true; };
    // `content` fully captures the render condition; `validationWarning` is a fresh object each render
    // and would re-fire this network probe every render — intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, pageId, envId]);

  // Convert this page: PUT the healed storage as the current user, then reload the macro so useConfig()
  // re-reads the now-populated `content` guest-param. Healing-only + idempotent.
  const handleConvert = async () => {
    setConvertState(prev => ({ ...prev, isConverting: true, error: null }));
    try {
      const { body, version, title: pageTitle } = convertState;
      let putRes = await putPageStorage(pageId, pageTitle, body, version);

      // 409: page changed since our read — re-read, re-convert, retry once.
      if (putRes.status === 409) {
        const fresh = await fetchAndConvert(pageId, envId);
        if (fresh) putRes = await putPageStorage(pageId, fresh.title, fresh.body, fresh.version);
      }

      // 403: the viewer can read the page but not edit it.
      if (putRes.status === 403) {
        setConvertState(prev => ({ ...prev, isConverting: false, error: 'macro.convert.no_permission' }));
        return;
      }
      if (!putRes.ok) {
        const detail = await putRes.text().catch(() => '');
        setConvertState(prev => ({
          ...prev,
          isConverting: false,
          error: { key: 'macro.convert.error', params: { message: `${putRes.status} ${detail.slice(0, 120)}`.trim() } },
        }));
        return;
      }

      // Success — reload so the macro picks up its now-populated content guest-param.
      await view.refresh();
    } catch (error) {
      setConvertState(prev => ({
        ...prev,
        isConverting: false,
        error: { key: 'macro.convert.error', params: { message: error?.message || 'unknown' } },
      }));
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

  // Fetch pending signers from the backend whenever signatures or config change.
  // The resolver resolves group members and page permission users server-side so that
  // inheritViewers and inheritEditors are reflected in the pending list.
  // Config is read server-side from req.context.extension.config (not sent in payload)
  // to avoid unstable object references from useConfig() causing an infinite effect loop.
  useEffect(() => {
    const fetchPendingSigners = async () => {
      // Need pageId before we can calculate
      if (!pageId) return;

      // No point fetching if content is invalid (macro not fully configured)
      if (!content || validationWarning) {
        setPendingState({ accountIds: [], isLoading: false });
        return;
      }

      setPendingState(prev => ({ ...prev, isLoading: true }));

      try {
        const signedAccountIds = (signatureState.entity?.signatures || []).map(s => s.accountId);

        const result = await invoke('getPendingSigners', {
          pageId,
          signedAccountIds,
        });

        if (result.success) {
          setPendingState({ accountIds: result.pending || [], isLoading: false });
        } else {
          console.error('Failed to fetch pending signers:', result.error);
          setPendingState({ accountIds: [], isLoading: false });
        }
      } catch (error) {
        console.error('Error fetching pending signers:', error);
        setPendingState({ accountIds: [], isLoading: false });
      }
    };

    fetchPendingSigners();
  }, [pageId, signatureState.entity, content, validationWarning]);

  const pendingSignatures = pendingState.accountIds;
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

  // If the Forge license is explicitly inactive, show a friendly notice.
  // licensed === null means context is still loading — the spinner above covers that.
  if (licensed === false) {
    return (
      <SectionMessage appearance="warning" title={t('license.inactive_title')}>
        <Text>{t('license.inactive_message')}</Text>
      </SectionMessage>
    );
  }

  // If validation fails (insufficient content), show warning instead of the macro.
  // When the empty content is actually an unconverted (post-CMA) legacy macro, offer a one-click,
  // healing-only Convert instead of the plain warning.
  if (validationWarning) {
    if (convertState.available) {
      return (
        <SectionMessage
          appearance={convertState.error ? 'error' : 'information'}
          title={t('macro.convert.needed_title')}
        >
          <Stack space="space.100">
            <Text>{t('macro.convert.needed_body')}</Text>
            {convertState.error && (
              <Text>
                {typeof convertState.error === 'string'
                  ? t(convertState.error)
                  : tp(convertState.error.key, convertState.error.params)}
              </Text>
            )}
            <LoadingButton
              appearance="primary"
              onClick={handleConvert}
              isLoading={convertState.isConverting}
            >
              {t('macro.convert.button')}
            </LoadingButton>
          </Stack>
        </SectionMessage>
      );
    }
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
                <Box xcss={popupContentStyles}>
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
                <Tooltip content={t('macro.email_modal.title_suffix')}>
                  <Button
                    appearance="subtle"
                    iconBefore="email"
                    onClick={() => setEmailPopupOpen(!emailPopupOpen)}
                    isDisabled={emailLoading}
                  />
                </Tooltip>
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
                      (visibilityLimit !== null && visibilityLimit !== undefined) && !showAllSigned
                        ? signatureState.entity.signatures.slice(0, visibilityLimit)
                        : signatureState.entity.signatures
                    }
                    label={t('ui.heading.signed')} 
                    formatDate={formatDate} 
                  />
                  {(visibilityLimit !== null && visibilityLimit !== undefined) && signatureState.entity.signatures.length > visibilityLimit && (
                    showAllSigned ? (
                      <Button
                        appearance="link"
                        onClick={() => setShowAllSigned(false)}
                      >
                        {t('ui.button.show_less')}
                      </Button>
                    ) : (
                      <Button
                        appearance="link"
                        onClick={() => setShowAllSigned(true)}
                      >
                        {tp('macro.show_more', { count: signatureState.entity.signatures.length - visibilityLimit })}
                      </Button>
                    )
                  )}
                </Stack>
              )}

              {/* Pending signatures section */}
              {showPendingSection && pendingState.isLoading && (
                <Inline space="space.100" alignBlock="center">
                  <Spinner size="small" />
                  <Text>{t('ui.heading.pending')}</Text>
                </Inline>
              )}
              {showPendingSection && !pendingState.isLoading && hasPendingSignatures && (
                <Signatures signatures={pendingSignatures} label={t('ui.heading.pending')}/>
              )}
              
              {signSuccess && (
                <SectionMessage appearance="confirmation">
                  <Text>{signSuccess}</Text>
                </SectionMessage>
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
                <LoadingButton
                  onClick={handleSign}
                  isLoading={uiState.isSigning}
                  isDisabled={authState.isChecking}
                  appearance="primary"
                >
                  {t('ui.button.sign')}
                </LoadingButton>
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
              <Stack space="space.200">
                <Text><Strong>{t('macro.email_modal.instruction')}</Strong></Text>
                <TextArea
                  value={emailModal.emails.join(emailSeparator === ';' ? '; ' : ', ')}
                  isReadOnly
                  minimumRows={4}
                />
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Inline space="space.200" spread="space-between">
                <Inline space="space.100">
                  <Toggle
                    id="separator-toggle"
                    isChecked={emailSeparator === ';'}
                    onChange={() => setEmailSeparator(emailSeparator === ',' ? ';' : ',')}
                  />
                  <Label htmlFor="separator-toggle">
                    {t('macro.email_modal.use_semicolon')}
                  </Label>
                </Inline>
                <Button appearance="primary" onClick={closeEmailModal}>
                  {t('ui.button.close')}
                </Button>
              </Inline>
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
