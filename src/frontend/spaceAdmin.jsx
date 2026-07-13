import React, { useState, useEffect, useRef } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  Stack,
  SectionMessage,
  ProgressBar,
  Box,
  LoadingButton,
  ButtonGroup,
  DynamicTable,
  Tabs,
  Tab,
  TabList,
  TabPanel,
  xcss,
  useTranslation,
  useProductContext,
  I18nProvider,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import { interpolate } from './utils/i18n';
import { runBatched } from './utils/batch';

const rightAlignStyle = xcss({ textAlign: 'right' });
const statsTableStyle = xcss({ width: 'fit-content' });
const tabPanelStyle = xcss({ paddingTop: 'space.100' });

/**
 * Space Settings surface (confluence:spaceSettings, gated isSpaceAdmin). Shows Statistics +
 * Migration scoped to the CURRENT space. The space is derived server-side from the resolver
 * context, so scan/convert lock to this space and run combining the app + this space admin's
 * access (asApp ∪ asUser) — letting a space admin heal view-restricted pages the app can't reach.
 */
const SpaceAdmin = () => {
  const { ready, t } = useTranslation();
  const tp = (key, params) => interpolate(t(key), params);

  const context = useProductContext();
  const spaceKey = context?.extension?.space?.key || '';

  const [statistics, setStatistics] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState(null);

  const [envId, setEnvId] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const [isScanInProgress, setIsScanInProgress] = useState(false);
  const scanAbortRef = useRef(false);
  const [isConvertInProgress, setIsConvertInProgress] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const [convertResults, setConvertResults] = useState([]);
  const [convertStats, setConvertStats] = useState(null);

  useEffect(() => {
    loadStatistics();
    (async () => {
      try {
        const ctx = await view.getContext();
        setEnvId(ctx?.environmentId || null);
      } catch { /* ignore */ }
    })();
  }, []);

  const loadStatistics = async () => {
    try {
      setLoadingStats(true);
      setError(null);
      // Resolver derives the space from context → space-scoped counts.
      const response = await invoke('adminData', { action: 'getStatistics' });
      if (response.success) {
        setStatistics({
          totalContracts: response.totalContracts,
          activeContracts: response.activeContracts,
          deletedContracts: response.deletedContracts,
          totalSignatures: response.totalSignatures,
        });
      } else {
        setError(response.error || 'error.failed_load_stats');
      }
    } catch (err) {
      setError({ key: 'error.failed_load_stats', params: { message: err.message } });
    } finally {
      setLoadingStats(false);
    }
  };

  if (!ready) return null;

  const statsHead = {
    cells: [
      { key: 'metric', content: t('admin.statistics.metric') },
      { key: 'value', content: <Box xcss={rightAlignStyle}>{t('admin.statistics.value')}</Box> },
    ],
  };
  const statsRows = statistics ? [
    ['total_contracts', statistics.totalContracts],
    ['active_contracts', statistics.activeContracts],
    ['deleted_contracts', statistics.deletedContracts],
    ['total_signatures', statistics.totalSignatures],
  ].map(([key, val]) => ({
    key,
    cells: [
      { key: 'metric', content: t(`admin.statistics.${key}`) },
      { key: 'value', content: <Box xcss={rightAlignStyle}>{val}</Box> },
    ],
  })) : [];

  const runScan = async () => {
    setIsScanInProgress(true);
    scanAbortRef.current = false;
    setScanResult(null);
    setConvertResults([]);
    setConvertStats(null);
    setScanStatus('');
    setError(null);
    const allPages = [];
    let totalMacros = 0;
    try {
      // No spaceKey in the payload — the resolver locks to this space via context.
      const { aborted } = await runBatched('migrationData', {
        action: 'migrationScan',
      }, (response) => {
        allPages.push(...response.pages);
        totalMacros += response.stats?.totalMacros || 0;
        setScanStatus(tp('admin.migration.scanning', { pages: allPages.length }));
      }, 0, () => scanAbortRef.current);
      setScanResult({ pages: allPages, totalPages: allPages.length, totalMacros, partial: aborted });
    } catch (e) {
      setError(e instanceof Error ? e.message : (e?.message || e || 'Scan failed'));
    } finally {
      setScanStatus('');
      setIsScanInProgress(false);
    }
  };

  const runConvert = async () => {
    setIsConvertInProgress(true);
    setConvertProgress(0);
    setConvertResults([]);
    setConvertStats(null);
    const pageIds = scanResult.pages.map((p) => p.id);
    let allResults = [];
    const totalStats = { processed: 0, converted: 0, skipped: 0, errors: 0 };
    try {
      await runBatched('migrationData', {
        action: 'migrationConvert',
        pageIds,
        envId,
      }, (d) => {
        allResults = [...allResults, ...d.results];
        totalStats.processed += d.stats.processed;
        totalStats.converted += d.stats.converted;
        totalStats.skipped += d.stats.skipped;
        totalStats.errors += d.stats.errors;
        setConvertProgress(d.offset / pageIds.length);
        setConvertResults(allResults);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : (e?.message || e || 'Convert failed'));
    }
    setConvertStats(totalStats);
    setIsConvertInProgress(false);
  };

  return (
    <Stack space="space.300">
      {error && (
        <SectionMessage appearance="error" title={t('error.generic')}>
          <Text>
            {typeof error === 'string'
              ? t(error)
              : (error.key && error.params ? tp(error.key, error.params) : t(error.key || 'error.generic'))}
          </Text>
        </SectionMessage>
      )}

      <Tabs id="space-admin-tabs">
        <TabList>
          <Tab>{t('admin.tabs.statistics')}</Tab>
          <Tab>{t('admin.tabs.migration')}</Tab>
        </TabList>

        {/* Statistics (space-scoped) */}
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <Stack space="space.200">
              <Text>{tp('admin.migration.current_space', { spaceKey })}</Text>
              {loadingStats ? (
                <Text>{t('ui.status.loading')}</Text>
              ) : statistics ? (
                <Stack space="space.100">
                  <Box xcss={statsTableStyle}>
                    <DynamicTable head={statsHead} rows={statsRows} />
                  </Box>
                  <Button onClick={loadStatistics}>{t('admin.refresh_stats')}</Button>
                </Stack>
              ) : (
                <Text>{t('admin.no_stats')}</Text>
              )}
            </Stack>
          </Box>
        </TabPanel>

        {/* Migration (locked to this space) */}
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <Stack space="space.200">
              <SectionMessage appearance="warning" title={t('admin.migration.title')}>
                <Text>{t('admin.migration.description')}</Text>
              </SectionMessage>

              <Text>{tp('admin.migration.current_space', { spaceKey })}</Text>

              {!envId && (
                <SectionMessage appearance="error">
                  <Text>{t('admin.migration.env_id_missing')}</Text>
                </SectionMessage>
              )}

              {envId && (
                <Stack space="space.100">
                  <ButtonGroup>
                    <LoadingButton onClick={runScan} isLoading={isScanInProgress} isDisabled={isConvertInProgress}>
                      {t('admin.migration.scan_button')}
                    </LoadingButton>
                    {isScanInProgress && (
                      <Button
                        appearance="danger"
                        onClick={() => { scanAbortRef.current = true; setScanStatus(t('admin.migration.scan_cancelling')); }}
                      >
                        {t('admin.migration.cancel_scan')}
                      </Button>
                    )}
                  </ButtonGroup>
                  {isScanInProgress && scanStatus && <Text>{scanStatus}</Text>}

                  {scanResult && (
                    <Stack space="space.100">
                      {scanResult.totalPages > 0 ? (
                        <>
                          <SectionMessage appearance="information">
                            <Text>{tp('admin.migration.scan_result', { pages: scanResult.totalPages, macros: scanResult.totalMacros })}</Text>
                          </SectionMessage>
                          <DynamicTable
                            head={{ cells: [
                              { key: 'id', content: t('admin.migration.table_page_id') },
                              { key: 'title', content: t('admin.migration.table_title') },
                              { key: 'macros', content: t('admin.migration.table_macros') },
                            ] }}
                            rows={scanResult.pages.map((p) => ({
                              key: p.id,
                              cells: [
                                { key: 'id', content: p.id },
                                { key: 'title', content: p.title },
                                { key: 'macros', content: String(p.macroCount) },
                              ],
                            }))}
                          />
                          <LoadingButton onClick={runConvert} isLoading={isConvertInProgress} appearance="primary">
                            {t('admin.migration.convert_button')}
                          </LoadingButton>

                          {isConvertInProgress && (
                            <Stack space="space.100">
                              <ProgressBar value={convertProgress} />
                              <Text>{tp('admin.migration.convert_progress', { current: convertResults.length, total: scanResult.totalPages })}</Text>
                            </Stack>
                          )}

                          {convertStats && (
                            <SectionMessage appearance="confirmation" title={t('admin.migration.convert_complete_title')}>
                              <Text>{tp('admin.migration.convert_complete', { converted: convertStats.converted, skipped: convertStats.skipped, errors: convertStats.errors })}</Text>
                            </SectionMessage>
                          )}

                          {convertResults.length > 0 && (
                            <DynamicTable
                              head={{ cells: [
                                { key: 'title', content: t('admin.migration.table_title') },
                                { key: 'status', content: t('admin.migration.table_status') },
                                { key: 'macros', content: t('admin.migration.table_macros') },
                              ] }}
                              rows={convertResults.map((r) => ({
                                key: r.pageId,
                                cells: [
                                  { key: 'title', content: r.title || r.pageId },
                                  { key: 'status', content: r.status },
                                  { key: 'macros', content: String(r.macroCount || 0) },
                                ],
                              }))}
                            />
                          )}
                        </>
                      ) : (
                        <SectionMessage appearance="confirmation">
                          <Text>{t('admin.migration.scan_empty')}</Text>
                        </SectionMessage>
                      )}
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <I18nProvider>
      <SpaceAdmin />
    </I18nProvider>
  </React.StrictMode>
);
