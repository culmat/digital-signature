import Resolver from '@forge/resolver';
import { signResolver } from './signResolver';
import { getSignaturesResolver } from './getSignaturesResolver';
import { checkAuthorizationResolver } from './checkAuthorizationResolver';
import { getPendingSignersResolver } from './getPendingSignersResolver';
import { adminDataResolver } from './adminDataResolver';
import { emailAddressesResolver } from './emailAddressesResolver';
import { migrationResolver } from './migrationResolver';
import { runSchemaMigrations } from '../storage/migrations/schema';
import { isConfluenceAdmin } from '../utils/adminAuth';

const resolver = new Resolver();

// Track if migrations have been run in this instance
let migrationsInitialized = false;
let siteUrlLogged = false;

/**
 * Logs the connected site URL on first resolver call
 */
function logConnectedSite(context) {
  if (!siteUrlLogged && context?.siteUrl) {
    console.log('=====================================');
    console.log(`🔗 Connected to: ${context.siteUrl}`);
    console.log('=====================================');
    siteUrlLogged = true;
  }
}

/**
 * Ensures database migrations have been run
 * Called automatically on first resolver execution
 */
async function ensureMigrationsRun() {
  if (!migrationsInitialized) {
    console.log('Initializing database schema...');
    await runSchemaMigrations();
    migrationsInitialized = true;
  }
}

// Wrap resolvers to ensure migrations run first and log site URL
function wrapResolver(resolverFn) {
  return async (req) => {
    logConnectedSite(req.context);
    await ensureMigrationsRun();
    return resolverFn(req);
  };
}

resolver.define('sign', wrapResolver(signResolver));
resolver.define('getSignatures', wrapResolver(getSignaturesResolver));
resolver.define('checkAuthorization', wrapResolver(checkAuthorizationResolver));
resolver.define('getPendingSigners', wrapResolver(getPendingSignersResolver));
resolver.define('adminData', wrapResolver(adminDataResolver));
resolver.define('getEmailAddresses', wrapResolver(emailAddressesResolver));
resolver.define('migrationData', wrapResolver(migrationResolver));

// Admin resolver to manually trigger migrations — requires Confluence admin
resolver.define('runMigrations', async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId) {
    return { success: false, error: 'error.unauthorized' };
  }
  const isAdmin = await isConfluenceAdmin(accountId);
  if (!isAdmin) {
    console.warn(`Non-admin user ${accountId} attempted to run migrations`);
    return { success: false, error: 'error.forbidden' };
  }

  try {
    await runSchemaMigrations();
    migrationsInitialized = true;
    return { success: true, message: 'Migrations completed successfully' };
  } catch (error) {
    console.error('Manual migration failed:', error);
    return { success: false, error: error.message };
  }
});

export const handler = resolver.getDefinitions();
