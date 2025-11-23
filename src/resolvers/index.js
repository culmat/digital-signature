import Resolver from '@forge/resolver';
import { signResolver } from './signResolver';
import { getSignaturesResolver } from './getSignaturesResolver';
import { checkAuthorizationResolver } from './checkAuthorizationResolver';
import { runSchemaMigrations } from '../storage/migrations/schema';

const resolver = new Resolver();

// Track if migrations have been run in this instance
let migrationsInitialized = false;

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

// Wrap resolvers to ensure migrations run first
function wrapResolver(resolverFn) {
  return async (...args) => {
    await ensureMigrationsRun();
    return resolverFn(...args);
  };
}

resolver.define('sign', wrapResolver(signResolver));
resolver.define('getSignatures', wrapResolver(getSignaturesResolver));
resolver.define('checkAuthorization', wrapResolver(checkAuthorizationResolver));

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
