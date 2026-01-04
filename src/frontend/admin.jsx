import React, { useState, useEffect } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  Stack,
  Heading,
  SectionMessage,
  ProgressBar,
  Box,
  Inline,
  Strong,
  LoadingButton,
  TextArea,
  ButtonGroup,
  DynamicTable
} from '@forge/react';
import { invoke } from '@forge/bridge';

const Admin = () => {
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
        setError(response.error || 'Failed to load statistics');
      }
    } catch (err) {
      setError(`Error loading statistics: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      setIsBackupInProgress(true);
      setBackupProgress(0);
      setBackupStatus('Starting backup...');
      setError(null);
      setBackupData('');

      const chunks = [];
      let offset = 0;
      let completed = false;

      while (!completed) {
        setBackupStatus(`Downloading chunk at offset ${offset}...`);

        const response = await invoke('adminData', {
          action: 'export',
          offset,
          limit: 5000
        });

        if (!response.success) {
          throw new Error(response.error || 'Backup failed');
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
      setBackupStatus(`Backup completed! File downloaded as ${filename}`);
    } catch (err) {
      setError(`Backup failed: ${err.message}`);
      setBackupStatus('');
    } finally {
      setIsBackupInProgress(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreData.trim()) {
      setError('Please paste backup data in the text area');
      return;
    }

    try {
      setIsRestoreInProgress(true);
      setRestoreStatus('Importing data...');
      setRestoreResult(null);
      setError(null);

      const response = await invoke('adminData', {
        action: 'import',
        data: restoreData.trim()
      });

      if (!response.success) {
        throw new Error(response.error || 'Restore failed');
      }

      setRestoreResult(response.summary);
      setRestoreStatus('Restore completed successfully!');
      setRestoreData('');

      await loadStatistics();
    } catch (err) {
      setError(`Restore failed: ${err.message}`);
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
        throw new Error(response.error || 'Deletion failed');
      }

      setDeleteResult(response);
      await loadStatistics();
    } catch (err) {
      setError(`Deletion failed: ${err.message}`);
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

  const statisticsTableHead = {
    cells: [
      { key: 'metric', content: 'Metric' },
      { key: 'value', content: 'Value' }
    ]
  };

  const statisticsTableRows = statistics ? [
    {
      key: 'total-contracts',
      cells: [
        { key: 'metric', content: 'Total Contracts' },
        { key: 'value', content: statistics.totalContracts }
      ]
    },
    {
      key: 'active-contracts',
      cells: [
        { key: 'metric', content: 'Active Contracts' },
        { key: 'value', content: statistics.activeContracts }
      ]
    },
    {
      key: 'deleted-contracts',
      cells: [
        { key: 'metric', content: 'Deleted Contracts' },
        { key: 'value', content: statistics.deletedContracts }
      ]
    },
    {
      key: 'total-signatures',
      cells: [
        { key: 'metric', content: 'Total Signatures' },
        { key: 'value', content: statistics.totalSignatures }
      ]
    }
  ] : [];

  return (
    <Stack space="medium">
      <Heading size="large">Administration</Heading>

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">Database Statistics</Heading>
          {loading ? (
            <Text>Loading statistics...</Text>
          ) : statistics ? (
            <Stack space="small">
              <DynamicTable
                head={statisticsTableHead}
                rows={statisticsTableRows}
              />
              <Box paddingBlockStart="space.100">
                <Button onClick={loadStatistics}>Refresh Statistics</Button>
              </Box>
            </Stack>
          ) : (
            <Text>No statistics available</Text>
          )}
        </Stack>
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">Backup Data</Heading>
          <Text>Export all signature data to a compressed SQL dump (base64-encoded .sql.gz)</Text>
          <Box paddingBlockStart="space.100">
            <LoadingButton
              onClick={handleBackup}
              isLoading={isBackupInProgress}
              isDisabled={isBackupInProgress || backupData.length > 0}
            >
              Generate Backup
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
                <Button onClick={handleClearBackup}>Clear</Button>
              </Box>
            </Stack>
          )}
        </Stack>
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">Restore Data</Heading>
          <Text>
            Paste backup data below. Accepts both base64-encoded .sql.gz content (from the textarea above)
            or plain SQL (from decompressed .sql.gz file).
          </Text>
          <TextArea
            value={restoreData}
            onChange={(e) => setRestoreData(e.target.value)}
            placeholder="Paste backup data here (base64 or plain SQL)..."
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
                Restore from Backup
              </LoadingButton>
              <Button
                onClick={() => setRestoreData('')}
                isDisabled={isRestoreInProgress}
              >
                Clear
              </Button>
            </ButtonGroup>
          </Box>
          {restoreStatus && <Text>{restoreStatus}</Text>}
          {restoreResult && (
            <SectionMessage appearance="confirmation" title="Restore Summary">
              <Stack space="small">
                {restoreResult.contractsInserted > 0 && (
                  <Text>New contracts: {restoreResult.contractsInserted}</Text>
                )}
                {restoreResult.contractsUpdated > 0 && (
                  <Text>Updated contracts: {restoreResult.contractsUpdated}</Text>
                )}
                {restoreResult.signaturesInserted > 0 && (
                  <Text>New signatures: {restoreResult.signaturesInserted}</Text>
                )}
                {restoreResult.signaturesUpdated > 0 && (
                  <Text>Updated signatures: {restoreResult.signaturesUpdated}</Text>
                )}
                {restoreResult.contractsInserted === 0 && restoreResult.contractsUpdated === 0 &&
                 restoreResult.signaturesInserted === 0 && restoreResult.signaturesUpdated === 0 && (
                  <Text>No changes - all data already exists with the same values</Text>
                )}
                <Text>Execution time: {restoreResult.executionTimeSeconds}s</Text>
                {restoreResult.errors && restoreResult.errors.length > 0 && (
                  <Text>Errors: {restoreResult.errors.length}</Text>
                )}
              </Stack>
            </SectionMessage>
          )}
        </Stack>
      </Box>

      <Box paddingBlock="space.200">
        <Stack space="small">
          <Heading size="medium">Danger Zone</Heading>
          <SectionMessage appearance="warning" title="Warning: Irreversible Action">
            <Text>
              Deleting all signature data will permanently remove all contracts and signatures from the database.
              This action cannot be undone. Make sure you have created a backup before proceeding.
            </Text>
          </SectionMessage>
          {!showDeleteConfirmation ? (
            <Box paddingBlockStart="space.100">
              <Button
                onClick={() => setShowDeleteConfirmation(true)}
                appearance="danger"
                isDisabled={isDeleteInProgress}
              >
                Delete All Signature Data
              </Button>
            </Box>
          ) : (
            <Stack space="small">
              <SectionMessage appearance="error" title="Confirmation Required">
                <Text>
                  Are you absolutely sure you want to delete ALL signature data? This will remove {statistics?.totalContracts || 0} contracts and {statistics?.totalSignatures || 0} signatures permanently.
                </Text>
              </SectionMessage>
              <Box paddingBlockStart="space.100">
                <ButtonGroup>
                  <LoadingButton
                    onClick={handleDeleteAll}
                    isLoading={isDeleteInProgress}
                    appearance="danger"
                  >
                    Yes, Delete Everything
                  </LoadingButton>
                  <Button
                    onClick={() => setShowDeleteConfirmation(false)}
                    isDisabled={isDeleteInProgress}
                  >
                    Cancel
                  </Button>
                </ButtonGroup>
              </Box>
            </Stack>
          )}
          {deleteResult && (
            <SectionMessage appearance="confirmation" title="Deletion Complete">
              <Stack space="small">
                <Text>Contracts deleted: {deleteResult.contractsDeleted}</Text>
                <Text>Signatures deleted: {deleteResult.signaturesDeleted}</Text>
                <Text>Execution time: {deleteResult.executionTimeSeconds}s</Text>
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
    <Admin />
  </React.StrictMode>
);
