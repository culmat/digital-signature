import React, { useEffect, useState, useMemo, useReducer } from 'react';
import ForgeReconciler, { useConfig, useProductContext, Box, Heading, Text, Button, Checkbox, Stack, AdfRenderer, SectionMessage, Strong, Spinner, xcss, User, Inline, Lozenge } from '@forge/react';

const Signatures = ({ signatures, preFix, formatDate }) => {
  return (
    <Box>
      <Heading size="small">{preFix} ({signatures.length})</Heading>
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
import { invoke, view } from '@forge/bridge';
import { checkForDynamicContent, validateTextContent } from './utils/adfValidator';
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
  const pageTitle = context?.extension?.content?.title;
  const macroBody = context?.extension?.macro?.body;
  const spaceKey = context?.extension?.space?.key;
  
  return useMemo(() => ({
    pageId,
    pageTitle: pageTitle || '',
    macroBody,
    spaceKey,
  }), [pageId, pageTitle, macroBody, spaceKey]);
}

const App = () => {
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

  const config = useConfig();
  const context = useProductContext();
  const { pageId, pageTitle, macroBody } = useContentContext(context);
  
  const panelTitle = config?.panelTitle || '';
  const configuredSigners = config?.signers || [];
  
  // Check for dynamic content in the macro body
  const dynamicContentWarning = macroBody ? checkForDynamicContent(macroBody) : null;
  
  // Check for insufficient text content
  const textContentWarning = macroBody ? validateTextContent(macroBody) : null;
  
  // Combined validation - check dynamic content first, then text content
  const validationWarning = dynamicContentWarning || textContentWarning;
  
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

  // Load signatures on mount and whenever macro body changes
  useEffect(() => {
    const loadSignatures = async () => {
      // Only load if we have valid content (passed validation)
      if (!macroBody || validationWarning) {
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
          pageTitle,
          macroBody
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
  }, [macroBody, pageId, pageTitle, validationWarning]);

  useEffect(() => {
    const checkAuth = async () => {
      if (!macroBody || validationWarning || !userState.accountId || !pageId) {
        dispatchAuth({ type: 'CLEAR_STATUS' });
        return;
      }

      try {
        dispatchAuth({ type: 'SET_CHECKING', payload: true });

        const result = await checkAuthorization(
          invoke,
          pageId,
          pageTitle,
          macroBody
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
  }, [signatureState.entity, macroBody, pageTitle, userState.accountId, pageId, validationWarning]);

  const handleSign = async () => {
    try {
      setUIState(prev => ({ ...prev, isSigning: true, actionError: null }));

      if (!pageId || !macroBody) {
        setUIState(prev => ({ ...prev, isSigning: false, actionError: 'Missing required data for signing' }));
        return;
      }

      // Sign using the client helper (computes hash internally)
      const result = await signDocument(
        invoke,
        pageId,
        pageTitle,
        macroBody
      );

      if (result.success) {
        dispatchSignature({ type: 'UPDATE_AFTER_SIGN', payload: result.signature });
        console.log(result.message);

        const authResult = await checkAuthorization(invoke, pageId, pageTitle, macroBody);
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
        setUIState(prev => ({ ...prev, isSigning: false, actionError: result.error || 'Failed to sign' }));
        console.error('Failed to sign:', result.error);
      }
    } catch (error) {
      setUIState(prev => ({ ...prev, isSigning: false, actionError: error.message || 'Error signing' }));
      console.error('Error signing:', error);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
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

  // If validation fails (dynamic content or insufficient text), show warning instead of the macro
  if (validationWarning) {
    return (
      <SectionMessage 
        appearance="warning"
        title="Cannot Use for Digital Signatures"
      >
        <Stack space="space.100">
          <Text>
            <Strong>{validationWarning.contentType}:</Strong> {validationWarning.contentDetails}
          </Text>
          <Text>
            {validationWarning.message}
          </Text>
          {validationWarning.type === 'insufficient-content' ? (
            <Text>
              Please add the complete contract text within the macro body. The contract must be fully contained 
              in this macro and not reference content elsewhere on the page.
            </Text>
          ) : (
            <Text>
              For a legally binding digital signature, the document content must be static and unchangeable. 
              Please remove the highlighted content from the macro body.
            </Text>
          )}
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
          
          {/* Signature section */}
          {signatureState.isLoading ? (
            <Spinner />
          ) : (
            <Stack space="space.200">
              {/* Signed signatures section */}
              {signatureState.entity?.signatures && signatureState.entity.signatures.length > 0 && (
                <Signatures signatures={signatureState.entity.signatures} preFix="Signed" formatDate={formatDate} />
              )}

              {/* Pending signatures section */}
              {hasPendingSignatures && (
                <Signatures signatures={pendingSignatures} preFix="Pending"/>
              )}
              
              {uiState.actionError && (
                <SectionMessage appearance="error" title="Error">
                  <Text>{uiState.actionError}</Text>
                </SectionMessage>
              )}

              {/* Sign button - show only if authorized */}
              {macroBody && userState.accountId && authState.status?.allowed && (
                <Button
                  onClick={handleSign}
                  isDisabled={uiState.isSigning || authState.isChecking}
                  appearance="primary"
                  >
                  {uiState.isSigning ? 'Signing...' : 'Sign'}
                </Button>
              )}
            </Stack>
          )}
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
