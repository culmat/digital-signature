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
  useTranslation,
  I18nProvider
} from '@forge/react';
import { invoke } from '@forge/bridge';

// Simple parameter interpolation for translation strings with {variable} placeholders.
// Forge's t() only supports (key, defaultValue) — it does not interpolate parameters.
const interpolate = (str, params) => {
  let result = str;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }
  return result;
};

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

  useEffect(() => {
    loadStatistics();
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
      { key: 'value', content: t('admin.statistics.value') }
    ]
  };

  const statisticsTableRows = statistics ? [
    {
      key: 'total-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.total_contracts') },
        { key: 'value', content: statistics.totalContracts }
      ]
    },
    {
      key: 'active-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.active_contracts') },
        { key: 'value', content: statistics.activeContracts }
      ]
    },
    {
      key: 'deleted-contracts',
      cells: [
        { key: 'metric', content: t('admin.statistics.deleted_contracts') },
        { key: 'value', content: statistics.deletedContracts }
      ]
    },
    {
      key: 'total-signatures',
      cells: [
        { key: 'metric', content: t('admin.statistics.total_signatures') },
        { key: 'value', content: statistics.totalSignatures }
      ]
    }
  ] : [];

  return (
    <Stack space="medium">
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

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">{t('ui.heading.statistics')}</Heading>
          {loading ? (
            <Text>{t('ui.status.loading')}</Text>
          ) : statistics ? (
            <Stack space="small">
              <DynamicTable
                head={statisticsTableHead}
                rows={statisticsTableRows}
              />
              <Box paddingBlockStart="space.100">
                <Button onClick={loadStatistics}>{t('admin.refresh_stats')}</Button>
              </Box>
            </Stack>
          ) : (
            <Text>{t('admin.no_stats')}</Text>
          )}
        </Stack>
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">{t('ui.heading.backup')}</Heading>
          <Text>{t('admin.backup_description')}</Text>
          <Box paddingBlockStart="space.100">
            <LoadingButton
              onClick={handleBackup}
              isLoading={isBackupInProgress}
              isDisabled={isBackupInProgress || backupData.length > 0}
            >
              {t('ui.button.generate_backup')}
            </LoadingButton>
          </Box>
          {backupStatus && <Text>{backupStatus}</Text>}
          {isBackupInProgress && backupProgress > 0 && (
            <ProgressBar value={backupProgress / 100} />
          )}
          {backupData && (
            <Stack space="small">
              <TextArea
                value={backupData}
                isReadOnly={true}
                minimumRows={10}
              />
              <Box paddingBlockStart="space.100">
                <Button onClick={handleClearBackup}>{t('ui.button.clear_backup')}</Button>
              </Box>
            </Stack>
          )}
        </Stack>
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">{t('ui.heading.restore')}</Heading>
          <Text>
            {t('admin.restore.description')}
          </Text>
          <TextArea
            value={restoreData}
            onChange={(e) => setRestoreData(e.target.value)}
            placeholder={t('admin.restore.placeholder')}
            minimumRows={10}
            isDisabled={isRestoreInProgress}
          />
          <Box paddingBlockStart="space.100">
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
          </Box>
          {restoreStatus && <Text>{restoreStatus}</Text>}
          {restoreResult && (
            <SectionMessage appearance="confirmation" title={t('admin.restore.summary.title')}>
              <Stack space="small">
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
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">{t('ui.heading.danger_zone')}</Heading>
          <SectionMessage appearance="warning" title={t('admin.delete.warning_title')}>
            <Text>
              {t('admin.delete.warning_description')}
            </Text>
          </SectionMessage>
          {!showDeleteConfirmation ? (
            <Box paddingBlockStart="space.100">
              <Button
                onClick={() => setShowDeleteConfirmation(true)}
                appearance="danger"
                isDisabled={isDeleteInProgress}
              >
                {t('admin.delete.title')}
              </Button>
            </Box>
          ) : (
            <Stack space="small">
              <SectionMessage appearance="error" title={t('admin.delete.confirm_title')}>
                <Text>
                  {tp('admin.delete.confirm_message', { contracts: statistics?.totalContracts || 0, signatures: statistics?.totalSignatures || 0 })}
                </Text>
              </SectionMessage>
              <Box paddingBlockStart="space.100">
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
              </Box>
            </Stack>
          )}
          {deleteResult && (
            <SectionMessage appearance="confirmation" title={t('admin.delete.summary_title')}>
              <Stack space="small">
                <Text>{tp('admin.delete.contracts_deleted', { count: deleteResult.contractsDeleted })}</Text>
                <Text>{tp('admin.delete.signatures_deleted', { count: deleteResult.signaturesDeleted })}</Text>
                <Text>{tp('admin.delete.execution_time', { count: deleteResult.executionTimeSeconds })}</Text>
              </Stack>
            </SectionMessage>
          )}
        </Stack>
      </Box>
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
