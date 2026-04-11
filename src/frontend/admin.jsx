import React, { useState, useEffect } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  Stack,
  Heading,
  SectionMessage,
  ProgressBar,
  Box,
  LoadingButton,
  TextArea,
  ButtonGroup,
  DynamicTable,
  Tabs,
  Tab,
  TabList,
  TabPanel,
  xcss,
  useTranslation,
  I18nProvider
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import { interpolate } from './utils/i18n';

const rightAlignStyle = xcss({ textAlign: 'right' });
const statsTableStyle = xcss({ width: 'fit-content' });
// TabPanel renders no top padding — add it manually.
const tabPanelStyle = xcss({ paddingTop: 'space.100' });

const Admin = () => {
  const { ready, t } = useTranslation();

  // Wrapper: translate key then interpolate {variable} placeholders
  const tp = (key, params) => interpolate(t(key), params);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [backupProgress, setBackupProgress] = useState(0);
  const [backupStatus, setBackupStatus] = useState('');
  const [isBackupInProgress, setIsBackupInProgress] = useState(false);
  const [backupData, setBackupData] = useState('');

  const [restoreStatus, setRestoreStatus] = useState('');
  const [isRestoreInProgress, setIsRestoreInProgress] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoreData, setRestoreData] = useState('');

  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteAllEnabled, setDeleteAllEnabled] = useState(false);

  // Migration tools state
  const [migrationEnvId, setMigrationEnvId] = useState(null);
  const [migrationSpaceKey, setMigrationSpaceKey] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [isScanInProgress, setIsScanInProgress] = useState(false);
  const [isConvertInProgress, setIsConvertInProgress] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const [convertResults, setConvertResults] = useState([]);
  const [convertStats, setConvertStats] = useState(null);

  useEffect(() => {
    loadStatistics();
    // Fetch environment ID for migration tools
    (async () => {
      try {
        const ctx = await view.getContext();
        setMigrationEnvId(ctx?.environmentId || null);
      } catch (e) {
        // Ignore
      }
    })();
  }, []);

  const loadStatistics = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await invoke('adminData', {
        action: 'getStatistics'
      });

      console.log('Statistics response:', response);

      if (response.success) {
        setStatistics({
          totalContracts: response.totalContracts,
          activeContracts: response.activeContracts,
          deletedContracts: response.deletedContracts,
          totalSignatures: response.totalSignatures
        });
        setDeleteAllEnabled(response.deleteAllEnabled === true);
      } else {
        setError(response.error || 'error.failed_load_stats');
      }
    } catch (err) {
      setError({ key: 'error.failed_load_stats', params: { message: err.message } });
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      setIsBackupInProgress(true);
      setBackupProgress(0);
      setBackupStatus(t('admin.backup.progress'));
      setError(null);
      setBackupData('');

      const chunks = [];
      let offset = 0;
      let completed = false;

      while (!completed) {
        setBackupStatus(tp('admin.backup.chunk', { offset }));

        const response = await invoke('adminData', {
          action: 'export',
          offset,
          limit: 5000
        });

        if (!response.success) {
          setError(response.error || 'error.failed_backup');
          setBackupStatus('');
          setIsBackupInProgress(false);
          return;
        }

        chunks.push(response.data);
        completed = response.completed;

        if (!completed) {
          offset = response.offset;
          const progress = Math.round(
            (response.stats.processedContracts / response.stats.totalContracts) * 100
          );
          setBackupProgress(progress);
        } else {
          setBackupProgress(100);
        }
      }

      const fullBackup = chunks.join('');
      
      // Trigger automatic download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `digital-signature-backup-${timestamp}.sql.gz`;
      downloadBackup(fullBackup, filename);
      
      setBackupData(fullBackup);
      setBackupStatus(tp('admin.backup.downloaded', { filename }));
    } catch (err) {
      setError({ key: 'error.failed_backup', params: { message: err.message } });
      setBackupStatus('');
    } finally {
      setIsBackupInProgress(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreData.trim()) {
      setError('admin.restore.error_empty');
      return;
    }

    try {
      setIsRestoreInProgress(true);
      setRestoreStatus(t('admin.restore.progress'));
      setRestoreResult(null);
      setError(null);

      const response = await invoke('adminData', {
        action: 'import',
        data: restoreData.trim()
      });

      if (!response.success) {
        setError(response.error || 'error.failed_restore');
        setRestoreStatus('');
        setIsRestoreInProgress(false);
        return;
      }

      setRestoreResult(response.summary);
      setRestoreStatus(t('admin.restore.success'));
      setRestoreData('');

      await loadStatistics();
    } catch (err) {
      setError({ key: 'error.failed_restore', params: { message: err.message } });
      setRestoreStatus('');
    } finally {
      setIsRestoreInProgress(false);
    }
  };

  const handleClearBackup = () => {
    setBackupData('');
    setBackupStatus('');
    setBackupProgress(0);
  };

  const handleDeleteAll = async () => {
    try {
      setIsDeleteInProgress(true);
      setDeleteResult(null);
      setError(null);
      setShowDeleteConfirmation(false);

      const response = await invoke('adminData', {
        action: 'deleteAll'
      });

      if (!response.success) {
        setError(response.error || 'error.failed_delete');
        setIsDeleteInProgress(false);
        return;
      }

      setDeleteResult(response);
      await loadStatistics();
    } catch (err) {
      setError({ key: 'error.failed_delete', params: { message: err.message } });
    } finally {
      setIsDeleteInProgress(false);
    }
  };

  const downloadBackup = (base64Data, filename) => {
    // Convert base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create blob and download
    const blob = new Blob([bytes], { type: 'application/gzip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Wait for translations to be ready before rendering
  if (!ready) return null;

  const statisticsTableHead = {
    cells: [
      { key: 'metric', content: t('admin.statistics.metric') },
      { key: 'value', content: <Box xcss={rightAlignStyle}>{t('admin.statistics.value')}</Box> }
    ]
  };

  const statisticsTableRows = statistics ? [
    {
      key: 'total-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.total_contracts') },
        { key: 'value', content: <Box xcss={rightAlignStyle}>{statistics.totalContracts}</Box> }
      ]
    },
    {
      key: 'active-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.active_contracts') },
        { key: 'value', content: <Box xcss={rightAlignStyle}>{statistics.activeContracts}</Box> }
      ]
    },
    {
      key: 'deleted-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.deleted_contracts') },
        { key: 'value', content: <Box xcss={rightAlignStyle}>{statistics.deletedContracts}</Box> }
      ]
    },
    {
      key: 'total-signatures',
      cells: [
        { key: 'metric', content: t('admin.statistics.total_signatures') },
        { key: 'value', content: <Box xcss={rightAlignStyle}>{statistics.totalSignatures}</Box> }
      ]
    }
  ] : [];

  return (
    <Stack space="space.300">
      <Heading size="large">{t('app.admin_title')}</Heading>

      {error && (
        <SectionMessage appearance="error" title={t('error.generic')}>
          <Text>
            {typeof error === 'string'
              ? t(error)
              : (error.key && error.params ? tp(error.key, error.params) : t(error.key || 'error.generic'))}
          </Text>
        </SectionMessage>
      )}

      <Tabs id="admin-tabs">
        <TabList>
          <Tab>{t('admin.tabs.statistics')}</Tab>
          <Tab>{t('admin.tabs.backup_restore')}</Tab>
          <Tab>{t('admin.tabs.migration')}</Tab>
          {deleteAllEnabled && <Tab>{t('admin.tabs.danger_zone')}</Tab>}
        </TabList>

        {/* Statistics Tab */}
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <Stack space="space.200">
              {loading ? (
                <Text>{t('ui.status.loading')}</Text>
              ) : statistics ? (
                <Stack space="space.100">
                  <Box xcss={statsTableStyle}>
                    <DynamicTable
                      head={statisticsTableHead}
                      rows={statisticsTableRows}
                    />
                  </Box>
                  <Button onClick={loadStatistics}>{t('admin.refresh_stats')}</Button>
                </Stack>
              ) : (
                <Text>{t('admin.no_stats')}</Text>
              )}
            </Stack>
          </Box>
        </TabPanel>

        {/* Backup & Restore Tab */}
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <Stack space="space.300">
              {/* Backup section */}
              <Stack space="space.100">
                <Heading size="medium">{t('ui.heading.backup')}</Heading>
                <Text>{t('admin.backup_description')}</Text>
                <LoadingButton
                  onClick={handleBackup}
                  isLoading={isBackupInProgress}
                  isDisabled={isBackupInProgress || backupData.length > 0}
                >
                  {t('ui.button.generate_backup')}
                </LoadingButton>
                {backupStatus && <Text>{backupStatus}</Text>}
                {isBackupInProgress && backupProgress > 0 && (
                  <ProgressBar value={backupProgress / 100} />
                )}
                {backupData && (
                  <Stack space="space.100">
                    <TextArea
                      value={backupData}
                      isReadOnly={true}
                      minimumRows={10}
                    />
                    <Button onClick={handleClearBackup}>{t('ui.button.clear_backup')}</Button>
                  </Stack>
                )}
              </Stack>

              {/* Restore section */}
              <Stack space="space.100">
                <Heading size="medium">{t('ui.heading.restore')}</Heading>
                <Text>{t('admin.restore.description')}</Text>
                <TextArea
                  value={restoreData}
                  onChange={(e) => setRestoreData(e.target.value)}
                  placeholder={t('admin.restore.placeholder')}
                  minimumRows={10}
                  isDisabled={isRestoreInProgress}
                />
                <ButtonGroup>
                  <LoadingButton
                    onClick={handleRestore}
                    isLoading={isRestoreInProgress}
                    isDisabled={isRestoreInProgress || !restoreData.trim()}
                    appearance="primary"
                  >
                    {t('ui.button.restore_data')}
                  </LoadingButton>
                  <Button
                    onClick={() => setRestoreData('')}
                    isDisabled={isRestoreInProgress}
                  >
                    {t('ui.button.close')}
                  </Button>
                </ButtonGroup>
                {restoreStatus && <Text>{restoreStatus}</Text>}
                {restoreResult && (
                  <SectionMessage appearance="confirmation" title={t('admin.restore.summary.title')}>
                    <Stack space="space.100">
                      {restoreResult.contractsInserted > 0 && (
                        <Text>{tp('admin.restore.summary.new_contracts', { count: restoreResult.contractsInserted })}</Text>
                      )}
                      {restoreResult.contractsUpdated > 0 && (
                        <Text>{tp('admin.restore.summary.updated_contracts', { count: restoreResult.contractsUpdated })}</Text>
                      )}
                      {restoreResult.signaturesInserted > 0 && (
                        <Text>{tp('admin.restore.summary.new_signatures', { count: restoreResult.signaturesInserted })}</Text>
                      )}
                      {restoreResult.signaturesUpdated > 0 && (
                        <Text>{tp('admin.restore.summary.updated_signatures', { count: restoreResult.signaturesUpdated })}</Text>
                      )}
                      {restoreResult.contractsInserted === 0 && restoreResult.contractsUpdated === 0 &&
                       restoreResult.signaturesInserted === 0 && restoreResult.signaturesUpdated === 0 && (
                        <Text>{t('admin.restore.summary.no_changes')}</Text>
                      )}
                      <Text>{tp('admin.restore.summary.execution_time', { count: restoreResult.executionTimeSeconds })}</Text>
                      {restoreResult.errors && restoreResult.errors.length > 0 && (
                        <Text>{tp('admin.restore.summary.errors', { count: restoreResult.errors.length })}</Text>
                      )}
                    </Stack>
                  </SectionMessage>
                )}
              </Stack>
            </Stack>
          </Box>
        </TabPanel>

        {/* Migration Tab */}
        <TabPanel>
          <Box xcss={tabPanelStyle}>
            <Stack space="space.200">
              <SectionMessage appearance="warning" title={t('admin.migration.title')}>
                <Text>{t('admin.migration.description')}</Text>
              </SectionMessage>

              {migrationEnvId ? (
                <Text>{tp('admin.migration.env_id_label', { envId: migrationEnvId })}</Text>
              ) : (
                <SectionMessage appearance="error">
                  <Text>{t('admin.migration.env_id_missing')}</Text>
                </SectionMessage>
              )}

              {migrationEnvId && (
                <Stack space="space.100">
                  <TextArea
                    value={migrationSpaceKey}
                    onChange={(e) => setMigrationSpaceKey(e.target.value)}
                    placeholder={t('admin.migration.space_placeholder')}
                    maxHeight="32px"
                  />

                  <LoadingButton
                    onClick={async () => {
                      setIsScanInProgress(true);
                      setScanResult(null);
                      setConvertResults([]);
                      setConvertStats(null);
                      setError(null);
                      try {
                        const response = await invoke('migrationData', {
                          action: 'migrationScan',
                          spaceKey: migrationSpaceKey.trim() || undefined,
                        });
                        if (response.success) {
                          setScanResult(response);
                        } else {
                          setError(response.error?.message || response.error || 'Scan failed');
                        }
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setIsScanInProgress(false);
                      }
                    }}
                    isLoading={isScanInProgress}
                    isDisabled={isConvertInProgress}
                  >
                    {t('admin.migration.scan_button')}
                  </LoadingButton>

                  {scanResult && (
                    <Stack space="space.100">
                      {scanResult.totalPages > 0 ? (
                        <>
                          <SectionMessage appearance="information">
                            <Text>{tp('admin.migration.scan_result', { pages: scanResult.totalPages, macros: scanResult.totalMacros })}</Text>
                          </SectionMessage>
                          <DynamicTable
                            head={{
                              cells: [
                                { key: 'id', content: t('admin.migration.table_page_id') },
                                { key: 'title', content: t('admin.migration.table_title') },
                                { key: 'space', content: t('admin.migration.table_space') },
                                { key: 'macros', content: t('admin.migration.table_macros') },
                              ],
                            }}
                            rows={scanResult.pages.map((p) => ({
                              key: p.id,
                              cells: [
                                { key: 'id', content: p.id },
                                { key: 'title', content: p.title },
                                { key: 'space', content: p.spaceKey },
                                { key: 'macros', content: String(p.macroCount) },
                              ],
                            }))}
                          />
                          <LoadingButton
                            onClick={async () => {
                              setIsConvertInProgress(true);
                              setConvertProgress(0);
                              setConvertResults([]);
                              setConvertStats(null);
                              const pageIds = scanResult.pages.map(p => p.id);
                              let offset = 0;
                              let allResults = [];
                              let totalStats = { processed: 0, converted: 0, skipped: 0, errors: 0 };
                              let completed = false;

                              while (!completed) {
                                try {
                                  const response = await invoke('migrationData', {
                                    action: 'migrationConvert',
                                    pageIds,
                                    offset,
                                    envId: migrationEnvId,
                                  });
                                  if (response.success) {
                                    const d = response;
                                    allResults = [...allResults, ...d.results];
                                    totalStats.processed += d.stats.processed;
                                    totalStats.converted += d.stats.converted;
                                    totalStats.skipped += d.stats.skipped;
                                    totalStats.errors += d.stats.errors;
                                    offset = d.offset;
                                    completed = d.completed;
                                    setConvertProgress(offset / pageIds.length);
                                    setConvertResults(allResults);
                                  } else {
                                    setError(response.error?.message || 'Convert failed');
                                    break;
                                  }
                                } catch (e) {
                                  setError(e.message);
                                  break;
                                }
                              }
                              setConvertStats(totalStats);
                              setIsConvertInProgress(false);
                            }}
                            isLoading={isConvertInProgress}
                            appearance="primary"
                          >
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
                              head={{
                                cells: [
                                  { key: 'title', content: t('admin.migration.table_title') },
                                  { key: 'status', content: t('admin.migration.table_status') },
                                  { key: 'macros', content: t('admin.migration.table_macros') },
                                ],
                              }}
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

        {/* Danger Zone Tab (only rendered when enabled) */}
        {deleteAllEnabled && (
          <TabPanel>
            <Box xcss={tabPanelStyle}>
              <Stack space="space.200">
                <SectionMessage appearance="warning" title={t('admin.delete.warning_title')}>
                  <Text>{t('admin.delete.warning_description')}</Text>
                </SectionMessage>
                {!showDeleteConfirmation ? (
                  <Button
                    onClick={() => setShowDeleteConfirmation(true)}
                    appearance="danger"
                    isDisabled={isDeleteInProgress}
                  >
                    {t('admin.delete.title')}
                  </Button>
                ) : (
                  <Stack space="space.100">
                    <SectionMessage appearance="error" title={t('admin.delete.confirm_title')}>
                      <Text>
                        {tp('admin.delete.confirm_message', { contracts: statistics?.totalContracts || 0, signatures: statistics?.totalSignatures || 0 })}
                      </Text>
                    </SectionMessage>
                    <ButtonGroup>
                      <LoadingButton
                        onClick={handleDeleteAll}
                        isLoading={isDeleteInProgress}
                        appearance="danger"
                      >
                        {t('ui.button.delete_everything')}
                      </LoadingButton>
                      <Button
                        onClick={() => setShowDeleteConfirmation(false)}
                        isDisabled={isDeleteInProgress}
                      >
                        {t('ui.button.cancel_deletion')}
                      </Button>
                    </ButtonGroup>
                  </Stack>
                )}
                {deleteResult && (
                  <SectionMessage appearance="confirmation" title={t('admin.delete.summary_title')}>
                    <Stack space="space.100">
                      <Text>{tp('admin.delete.contracts_deleted', { count: deleteResult.contractsDeleted })}</Text>
                      <Text>{tp('admin.delete.signatures_deleted', { count: deleteResult.signaturesDeleted })}</Text>
                      <Text>{tp('admin.delete.execution_time', { count: deleteResult.executionTimeSeconds })}</Text>
                    </Stack>
                  </SectionMessage>
                )}
              </Stack>
            </Box>
          </TabPanel>
        )}
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <I18nProvider>
      <Admin />
    </I18nProvider>
  </React.StrictMode>
);
