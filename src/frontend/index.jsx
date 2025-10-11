import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useConfig, useProductContext, Box, Heading, Text, Button, Checkbox, Stack, AdfRenderer, SectionMessage, Strong, Spinner, xcss, User, Inline } from '@forge/react';

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
        {date ? <> – {date}</> : null}
      </Text>
    </Inline>
  );
};
import { invoke, view } from '@forge/bridge';
import { checkForDynamicContent, validateTextContent } from './utils/adfValidator';
import { computeHash, signDocument, getSignatures } from './utils/signatureClient';

// Default locale fallback for date formatting
const DEFAULT_LOCALE = 'en-GB';

const App = () => {
  // State for signature data fetched from storage
  const [signatureEntity, setSignatureEntity] = useState(null);
  // State for loading indicators
  const [isLoadingSignatures, setIsLoadingSignatures] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  // State for the current content hash
  const [contentHash, setContentHash] = useState(null);
  // State for the current user's accountId
  const [currentUserAccountId, setCurrentUserAccountId] = useState(null);
  // State for the user's locale
  const [userLocale, setUserLocale] = useState(DEFAULT_LOCALE);

  const config = useConfig();
  const context = useProductContext();
  
  const panelTitle = config?.panelTitle || '';
  const configuredSigners = config?.signers || [];
  const macroBody = context?.extension?.macro?.body;
  
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
        setCurrentUserAccountId(context.accountId);
        setUserLocale(context.locale || DEFAULT_LOCALE); // Store user's locale with fallback
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
        setIsLoadingSignatures(false);
        return;
      }

      try {
        setIsLoadingSignatures(true);
        
        // Get page context for hash computation
        const pageId = context?.extension?.content?.id;
        const pageTitle = context?.extension?.content?.title || '';
        
        if (!pageId) {
          console.error('No page ID found in context');
          setIsLoadingSignatures(false);
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
          setSignatureEntity(result.signature);
          setContentHash(result.hash);
        } else {
          console.error('Failed to load signatures:', result.error);
        }
      } catch (error) {
        console.error('Error loading signatures:', error);
      } finally {
        setIsLoadingSignatures(false);
      }
    };

    loadSignatures();
  }, [macroBody, context?.extension?.content?.id, validationWarning]);

  // Handler for signing the document
  const handleSign = async () => {
    try {
      setIsSigning(true);
      
      const pageId = context?.extension?.content?.id;
      const pageTitle = context?.extension?.content?.title || '';
      
      if (!pageId || !macroBody) {
        console.error('Missing required data for signing');
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
        // Update the signature entity with the new signature
        setSignatureEntity(result.signature);
        console.log(result.message);
      } else {
        console.error('Failed to sign:', result.error);
      }
    } catch (error) {
      console.error('Error signing document:', error);
    } finally {
      setIsSigning(false);
    }
  };

  // Helper function to format date using user's locale
  const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    const formatter = new Intl.DateTimeFormat(userLocale, {
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

    // Get list of users who have already signed
    const signedAccountIds = new Set(
      (signatureEntity?.signatures || []).map(sig => sig.accountId)
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
          {isLoadingSignatures ? (
            <Spinner />
          ) : (
            <Stack space="space.200">
              {/* Signed signatures section */}
              {signatureEntity?.signatures && signatureEntity.signatures.length > 0 && (
                <Signatures signatures={signatureEntity.signatures} preFix="Signed" formatDate={formatDate} />
              )}

              {/* Pending signatures section */}
              {hasPendingSignatures && (
                <Signatures signatures={pendingSignatures} preFix="Pending"/>
              )}
              
              {/* No signers configured message */}
              {configuredSigners.length === 0 && 
               (!signatureEntity?.signatures || signatureEntity.signatures.length === 0) && (
                <Text>No signers configured. Anyone can sign this document.</Text>
              )}
              
              {/* Sign button - show if user can sign */}
              {macroBody && currentUserAccountId && (() => {
                const hasSigned = signatureEntity?.signatures?.some(sig => sig.accountId === currentUserAccountId);
                const isPending = pendingSignatures.includes(currentUserAccountId);
                const noPetitionMode = configuredSigners.length === 0;
                
                // Show button if user hasn't signed AND (is pending OR no signers configured)
                const canSign = !hasSigned && (isPending || noPetitionMode);
                
                return canSign ? (
                  <Button
                    appearance="primary"
                    onClick={handleSign}
                    isDisabled={isSigning}
                  >
                    {isSigning ? 'Signing...' : 'Sign Document'}
                  </Button>
                ) : null;
              })()}
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
