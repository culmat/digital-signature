import Resolver from '@forge/resolver';
import { signResolver } from './signResolver';
import { getSignaturesResolver } from './getSignaturesResolver';
import { checkAuthorizationResolver } from './checkAuthorizationResolver';
import { adminDataResolver } from './adminDataResolver';
import { runSchemaMigrations } from '../storage/migrations/schema';

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
resolver.define('adminData', wrapResolver(adminDataResolver));

// Admin resolver to manually trigger migrations
resolver.define('runMigrations', async () => {
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
