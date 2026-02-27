import { exportData, importData, getStatistics, deleteAllData } from '../storage/backupManager';
import { successResponse, errorResponse } from '../utils/responseHelper';

// Admin authorization is enforced by Confluence for the globalSettings module.
// No additional check is needed as only Confluence administrators can access this page.
export async function adminDataResolver(req) {
  const { context, payload } = req;
  const accountId = context.accountId;

  if (!accountId) {
    return errorResponse('error.unauthorized', 401);
  }

  try {
    const action = payload?.action;

    if (action === 'export') {
      return await handleExport(req);
    } else if (action === 'import') {
      return await handleImport(req);
    } else if (action === 'getStatistics') {
      return await handleGetStatistics();
    } else if (action === 'deleteAll') {
      return await handleDeleteAll();
    } else {
      return errorResponse({
        key: 'error.unknown_action',
        params: { action }
      }, 400);
    }
  } catch (error) {
    console.error('Admin data resolver error:', error);
    return errorResponse({
      key: 'error.generic',
      params: { message: error.message }
    }, 500);
  }
}

async function handleExport(req) {
  const { payload } = req;
  const offset = payload?.offset || 0;
  const limit = payload?.limit || 5000;

  console.log(`Starting export with offset=${offset}, limit=${limit}`);

  const result = await exportData(offset, limit);

  console.log(`Export chunk completed. Processed ${result.stats.processedContracts} contracts, ${result.stats.processedSignatures} signatures`);

  return successResponse(result);
}

async function handleImport(req) {
  const { payload } = req;

  if (!payload?.data) {
    return errorResponse({
      key: 'error.missing_fields',
      params: { fields: 'data' }
    }, 400);
  }

  console.log('Starting import operation');

  const result = await importData(payload.data);

  console.log(`Import completed. Contracts: ${result.summary.contractsInserted} inserted, ${result.summary.contractsUpdated} updated. Signatures: ${result.summary.signaturesInserted} inserted, ${result.summary.signaturesUpdated} updated`);

  return successResponse(result);
}

async function handleGetStatistics() {
  const stats = await getStatistics();

  return successResponse({ ...stats, deleteAllEnabled: process.env.ENABLE_DELETE_ALL === 'true' });
}

async function handleDeleteAll() {
  if (process.env.ENABLE_DELETE_ALL !== 'true') {
    return errorResponse('error.delete_not_enabled', 403);
  }

  console.log('Starting deletion of all signature data');

  const result = await deleteAllData();

  console.log(`Deletion completed. ${result.contractsDeleted} contracts and ${result.signaturesDeleted} signatures deleted`);

  return successResponse(result);
}

