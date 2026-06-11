/**
 * About panel rendered inside the admin page's About tab.
 *
 * Layout: a compact property table for version/environment/license/build,
 * a SectionMessage when an upgrade is available, the debug blob shown
 * inline with a Copy button, and a short closing paragraph with feedback/
 * review/documentation links.
 *
 * Every failure mode degrades silently — the panel still shows the bundled
 * commit SHA so support reports always have the anchor that identifies
 * which code is running.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  useProductContext,
  useTranslation,
  Box,
  Stack,
  Inline,
  Image,
  Heading,
  Text,
  Link,
  Button,
  Lozenge,
  Spinner,
  Strong,
  CodeBlock,
  SectionMessage,
  DynamicTable,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import buildInfo from '../shared/buildInfo.json';
import appIcon from './assets/app-icon.png';

const REPO_URL = 'https://github.com/culmat/digital-signature';
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const ISSUES_URL = `${REPO_URL}/issues`;
const MARKETPLACE_REVIEWS_URL =
  'https://marketplace.atlassian.com/apps/1217404/digital-signature-for-confluence?tab=reviews';
const DOCS_URL = 'https://culm.at/digital-signature/';

/* Logo-clamp pattern: Image would otherwise expand to its default xlarge
   size inside an Inline flex row. We pin the wrapper to a 96px box. */
const logoWrap = xcss({ width: '96px', height: '96px' });
/* Cap the table so the logo has room to sit flush-right even on wide
   viewports. 480px matches the visual weight of the five-row property table. */
const tableWrap = xcss({ maxWidth: '480px' });
const rootStyle = xcss({ paddingTop: 'space.200' });
/* The debug CodeBlock contains long lines (full SHA, browser UA) that would
   otherwise push the whole admin pane wider than the viewport. Constraining
   the wrapper to the parent's width, combined with `minWidth: 0` so it can
   shrink inside a flex container, keeps overflow scrollbars inside the block. */
const codeBlockWrap = xcss({ width: '100%', minWidth: '0' });

function commitUrl(fullSha) {
  return `${REPO_URL}/commit/${fullSha}`;
}

function adminHubUrl(cloudId) {
  return `https://admin.atlassian.com/s/${cloudId}/user-connected-apps`;
}

/**
 * Best-effort clipboard write. The Clipboard API throws NotAllowedError in
 * Forge UI Kit iframes when the host doesn't grant `clipboard-write`; fall
 * back to the legacy `execCommand('copy')` path, which works under a user
 * gesture (the button click supplies one).
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function statusLozenge(status, t) {
  if (status === 'current') {
    return (
      <Lozenge appearance="success">
        {t('admin.about.status_label_current')}
      </Lozenge>
    );
  }
  if (status === 'older-major') {
    return (
      <Lozenge appearance="moved">
        {t('admin.about.status_label_older_major')}
      </Lozenge>
    );
  }
  return <Lozenge>{t('admin.about.status_label_unknown')}</Lozenge>;
}

function licenseLabel(license, t) {
  if (!license) return t('admin.about.license_na');
  if (license.isEvaluation) return t('admin.about.license_evaluation');
  return license.active
    ? t('admin.about.license_active')
    : t('admin.about.license_inactive');
}

/**
 * Render a translation template that contains `{placeholder}` tokens,
 * substituting each token with a React node. Lets us keep one-sentence
 * translations intact per locale while still inlining real `<Link>` elements
 * where the linked text would sit.
 *
 * Unknown placeholders (no matching substitution) are left as the raw token
 * so missing translations surface visibly instead of disappearing.
 */
function renderWithLinks(template, substitutions) {
  if (!template) return null;
  const parts = template.split(/\{(\w+)\}/g);
  // Even indexes are plain text, odd indexes are placeholder names.
  return parts.map((part, i) =>
    i % 2 === 1 ? (substitutions[part] ?? `{${part}}`) : part,
  );
}

const AboutPanel = () => {
  const context = useProductContext();
  const { t } = useTranslation();

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    invoke('getVersionInfo')
      .then((res) => {
        if (cancelled) return;
        // `successResponse` returns { success: true, ...fields } with the
        // payload spread at the top level (see utils/responseHelper.js).
        // On { success: false } fall back to empty object — panel still shows
        // the bundled SHA without a status chip.
        setInfo(res && res.success ? res : {});
      })
      .catch(() => {
        if (!cancelled) setInfo({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cloudId = context?.cloudId;
  const status = info?.status || 'unknown';
  const myVersion = info?.myVersion;
  const latestVersion = info?.latestVersion;
  const environmentType = info?.environmentType || context?.environmentType;
  const license = info?.license ?? context?.license ?? null;

  /* Debug blob: every line is individually useful in a support report. No
     redundant `status` — version vs latest tells that story directly. */
  const debugBlob = [
    `sha:     ${buildInfo.commitSha}`,
    `version: ${myVersion || 'unknown'}`,
    `latest:  ${latestVersion || 'unknown'}`,
    `env:     ${environmentType || 'unknown'}`,
    `ua:      ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
  ].join('\n');

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(debugBlob);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 2000);
  }, [debugBlob]);

  /* Build the DynamicTable rows eagerly — the data is already resolved by the
     time we render this. Order: version, environment, app license, source
     license, build. */
  const rows = [
    {
      key: 'version',
      cells: [
        { content: <Text>{t('admin.about.version_label')}</Text> },
        {
          content: (
            <Inline space="space.100" alignBlock="center">
              {statusLozenge(status, t)}
              {myVersion && (
                <Text>
                  <Strong>{myVersion}</Strong>
                </Text>
              )}
            </Inline>
          ),
        },
      ],
    },
    {
      key: 'environment',
      cells: [
        { content: <Text>{t('admin.about.environment_label')}</Text> },
        {
          content: environmentType ? (
            <Lozenge>{environmentType}</Lozenge>
          ) : (
            <Text>—</Text>
          ),
        },
      ],
    },
    {
      key: 'app-license',
      cells: [
        { content: <Text>{t('admin.about.app_license_label')}</Text> },
        { content: <Text>{licenseLabel(license, t)}</Text> },
      ],
    },
    {
      key: 'source-license',
      cells: [
        { content: <Text>{t('admin.about.source_license_label')}</Text> },
        {
          content: (
            <Link href={LICENSE_URL} openNewTab>
              {t('admin.about.source_license_name')}
            </Link>
          ),
        },
      ],
    },
    {
      key: 'build',
      cells: [
        { content: <Text>{t('admin.about.build_label')}</Text> },
        {
          content: (
            <Link href={commitUrl(buildInfo.commitSha)} openNewTab>
              {buildInfo.commitSha}
            </Link>
          ),
        },
      ],
    },
  ];

  return (
    <Box xcss={rootStyle}>
      <Stack space="space.300">
        {/* Upgrade banner — only shown when a newer major is known to exist. */}
        {status === 'older-major' && (
          <SectionMessage
            appearance="warning"
            title={t('admin.about.status_label_older_major')}
          >
            <Text>{t('admin.about.status_older_major')}</Text>
            {cloudId && (
              <Text>
                <Link href={adminHubUrl(cloudId)} openNewTab>
                  {t('admin.about.upgrade_cta')}
                </Link>
              </Text>
            )}
          </SectionMessage>
        )}

        {/* Two-column top row: property table on the left, app icon flushed
            to the right. */}
        <Inline
          space="space.400"
          alignBlock="start"
          spread="space-between"
          shouldWrap
        >
          <Box xcss={tableWrap}>
            {loading ? <Spinner size="small" /> : <DynamicTable rows={rows} />}
          </Box>
          <Box xcss={logoWrap}>
            <Image src={appIcon} alt="" width={96} height={96} />
          </Box>
        </Inline>

        {/* Closing — documentation first, then the tracking/feedback note. */}
        <Text>
          {renderWithLinks(t('admin.about.documentation'), {
            documentation: (
              <Link key="docs" href={DOCS_URL} openNewTab>
                {t('admin.about.documentation_link')}
              </Link>
            ),
          })}
        </Text>
        <Text>
          {renderWithLinks(t('admin.about.tracking'), {
            feedback: (
              <Link key="feedback" href={ISSUES_URL} openNewTab>
                {t('admin.about.tracking_feedback')}
              </Link>
            ),
            review: (
              <Link key="review" href={MARKETPLACE_REVIEWS_URL} openNewTab>
                {t('admin.about.tracking_review')}
              </Link>
            ),
          })}
        </Text>

        {/* Debug info last — always visible so support reports have the
            context the first time someone asks. */}
        <Stack space="space.100">
          <Inline space="space.200" alignBlock="center" spread="space-between">
            <Heading size="small">{t('admin.about.debug_heading')}</Heading>
            <Button testId="about-debug-copy" onClick={handleCopy}>
              {copyState === 'copied'
                ? t('admin.about.debug_copied')
                : copyState === 'failed'
                  ? t('admin.about.debug_copy_failed')
                  : t('admin.about.debug_copy')}
            </Button>
          </Inline>
          <Box xcss={codeBlockWrap}>
            <CodeBlock language="text" text={debugBlob} />
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
};

export default AboutPanel;
