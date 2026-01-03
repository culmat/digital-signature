import { isConfluenceAdmin } from '../utils/adminAuth';
import { exportData, importData, getStatistics } from '../storage/backupManager';
import { successResponse, errorResponse } from '../utils/responseHelper';

export async function adminDataResolver(req) {
  const { context, payload } = req;
  const accountId = context.accountId;

  if (!accountId) {
    return errorResponse(401, 'User not authenticated');
  }

  const isAdmin = await isConfluenceAdmin(accountId);

  if (!isAdmin) {
    console.warn(`Non-admin user ${accountId} attempted to access admin endpoint`);
    return errorResponse(403, 'Access denied. Confluence administrator privileges required.');
  }

  try {
    if (req.method === 'GET') {
      return await handleExport(req);
    } else if (req.method === 'PUT') {
      return await handleImport(req);
    } else if (req.method === 'POST' && payload?.action === 'getStatistics') {
      return await handleGetStatistics();
    } else {
      return errorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('Admin data resolver error:', error);
    return errorResponse(500, `Operation failed: ${error.message}`);
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
    return errorResponse(400, 'Missing required field: data');
  }

  console.log('Starting import operation');

  const result = await importData(payload.data);

  console.log(`Import completed. Contracts: ${result.summary.contractsInserted} inserted, ${result.summary.contractsUpdated} updated. Signatures: ${result.summary.signaturesInserted} inserted, ${result.summary.signaturesUpdated} updated`);

  return successResponse(result);
}

async function handleGetStatistics() {
  const stats = await getStatistics();

  return successResponse(stats);
}
