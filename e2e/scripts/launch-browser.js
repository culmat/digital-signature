#!/usr/bin/env node
/**
 * Launch Chromium with remote debugging for e2e tests.
 * Reads configuration from e2e/.env
 */

const { spawn } = require('child_process');
const path = require('path');

// Load .env from e2e directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const HOST = process.env.CONFLUENCE_HOST;
const SPACE = process.env.TEST_SPACE || 'TEST';
const CDP_PORT = (process.env.CDP_ENDPOINT || 'http://localhost:9222').match(/:(\d+)/)?.[1] || '9222';

if (!HOST) {
  console.error('Error: CONFLUENCE_HOST not set in e2e/.env');
  process.exit(1);
}

const url = `https://${HOST}/wiki/spaces/${SPACE}/`;
const userDataDir = '/tmp/pw-test';

console.log(`Launching Chromium...`);
console.log(`  Debug port: ${CDP_PORT}`);
console.log(`  URL: ${url}`);
console.log(`  User data: ${userDataDir}`);
console.log(`\nLog into Confluence, then run: npm run test:e2e\n`);

const child = spawn('chromium', [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--ignore-certificate-errors',
  '--test-type',  // Suppress warning banner about unsupported flags
  url,
], {
  detached: true,
  stdio: 'ignore',
});

child.unref();
console.log(`Chromium launched (PID: ${child.pid})`);
