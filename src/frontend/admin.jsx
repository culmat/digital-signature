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
  ButtonGroup
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

  return (
    <Stack space="medium">
      <Heading size="large">Digital Signature Administration</Heading>

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <Box>
        <Heading size="medium">Database Statistics</Heading>
        {loading ? (
          <Text>Loading statistics...</Text>
        ) : statistics ? (
          <Stack space="small">
            <Inline space="small">
              <Strong>Total Contracts:</Strong>
              <Text>{statistics.totalContracts}</Text>
            </Inline>
            <Inline space="small">
              <Strong>Active Contracts:</Strong>
              <Text>{statistics.activeContracts}</Text>
            </Inline>
            <Inline space="small">
              <Strong>Deleted Contracts:</Strong>
              <Text>{statistics.deletedContracts}</Text>
            </Inline>
            <Inline space="small">
              <Strong>Total Signatures:</Strong>
              <Text>{statistics.totalSignatures}</Text>
            </Inline>
            <Button text="Refresh Statistics" onClick={loadStatistics} />
          </Stack>
        ) : (
          <Text>No statistics available</Text>
        )}
      </Box>

      <Box>
        <Heading size="medium">Backup Data</Heading>
        <Stack space="small">
          <Text>Export all signature data to a compressed SQL dump (base64-encoded .sql.gz)</Text>
          <LoadingButton
            text="Generate Backup"
            onClick={handleBackup}
            isLoading={isBackupInProgress}
            isDisabled={isBackupInProgress || backupData.length > 0}
          />
          {backupStatus && <Text>{backupStatus}</Text>}
          {isBackupInProgress && backupProgress > 0 && (
            <ProgressBar value={backupProgress / 100} />
          )}
          {backupData && (
            <Stack space="small">
              <Text>Copy this data and save it to a file with .sql.gz extension:</Text>
              <TextArea
                value={backupData}
                isReadOnly={true}
                minimumRows={10}
              />
              <Button text="Clear" onClick={handleClearBackup} />
            </Stack>
          )}
        </Stack>
      </Box>

      <Box>
        <Heading size="medium">Restore Data</Heading>
        <Stack space="small">
          <Text>Paste the backup data (base64-encoded .sql.gz content) below and click Restore:</Text>
          <TextArea
            value={restoreData}
            onChange={(value) => setRestoreData(value)}
            placeholder="Paste backup data here..."
            minimumRows={10}
            isDisabled={isRestoreInProgress}
          />
          <ButtonGroup>
            <LoadingButton
              text="Restore from Backup"
              onClick={handleRestore}
              isLoading={isRestoreInProgress}
              isDisabled={isRestoreInProgress || !restoreData.trim()}
              appearance="primary"
            />
            <Button
              text="Clear"
              onClick={() => setRestoreData('')}
              isDisabled={isRestoreInProgress}
            />
          </ButtonGroup>
          {restoreStatus && <Text>{restoreStatus}</Text>}
          {restoreResult && (
            <SectionMessage appearance="confirmation" title="Restore Summary">
              <Stack space="small">
                <Text>Contracts inserted: {restoreResult.contractsInserted}</Text>
                <Text>Contracts updated: {restoreResult.contractsUpdated}</Text>
                <Text>Signatures inserted: {restoreResult.signaturesInserted}</Text>
                <Text>Signatures updated: {restoreResult.signaturesUpdated}</Text>
                <Text>Execution time: {restoreResult.executionTimeSeconds}s</Text>
                {restoreResult.errors && restoreResult.errors.length > 0 && (
                  <Text>Errors: {restoreResult.errors.length}</Text>
                )}
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
