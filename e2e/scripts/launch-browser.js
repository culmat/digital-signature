#!/usr/bin/env node
/**
 * Launch Chromium with remote debugging for e2e tests.
 * Reads configuration from e2e/.env
 *
 * Usage:
 *   node launch-browser.js           # Launch browser for manual testing
 *   node launch-browser.js --codegen # Launch playwright codegen
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const HOST = process.env.CONFLUENCE_HOST;
const SPACE = process.env.TEST_SPACE || 'TEST';
const CDP_PORT = (process.env.CDP_ENDPOINT || 'http://localhost:9222').match(/:(\d+)/)?.[1] || '9222';
const CODEGEN_MODE = process.argv.includes('--codegen');
const SAVE_AUTH_MODE = process.argv.includes('--save-auth');
const AUTH_FILE = path.join(__dirname, '..', '.auth-state.json');

if (!HOST) {
  console.error('Error: CONFLUENCE_HOST not set in e2e/.env');
  process.exit(1);
}

/**
 * Find Chromium/Chrome executable path based on platform.
 * Checks Playwright's cached browsers first, then system installations.
 */
function findBrowserExecutable() {
  const platform = os.platform();
  const homedir = os.homedir();

  if (platform === 'darwin') {
    // macOS: Check Playwright cache first, then system Chrome
    const playwrightCacheDir = path.join(homedir, 'Library/Caches/ms-playwright');
    if (fs.existsSync(playwrightCacheDir)) {
      const chromiumDirs = fs.readdirSync(playwrightCacheDir)
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse();

      for (const dir of chromiumDirs) {
        const execPath = path.join(playwrightCacheDir, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium');
        if (fs.existsSync(execPath)) return execPath;
      }
    }

    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'linux') {
    const linuxPaths = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
    for (const cmd of linuxPaths) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return cmd;
      } catch {}
    }
  } else if (platform === 'win32') {
    const winPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

const browserPath = findBrowserExecutable();
if (!browserPath) {
  console.error('Error: Could not find Chromium or Chrome. Install Playwright browsers with: npx playwright install chromium');
  process.exit(1);
}

const url = `https://${HOST}/wiki/spaces/${SPACE}/`;
const userDataDir = '/tmp/pw-test';

if (SAVE_AUTH_MODE) {
  // Save auth state from running browser
  console.log(`Saving auth state from running browser...`);
  console.log(`  CDP port: ${CDP_PORT}`);
  console.log(`  Output: ${AUTH_FILE}\n`);

  const script = `
    const { chromium } = require('@playwright/test');
    (async () => {
      try {
        const browser = await chromium.connectOverCDP('http://localhost:${CDP_PORT}');
        const contexts = browser.contexts();
        const context = contexts[0];
        if (!context) {
          console.error('No browser context found');
          process.exit(1);
        }
        await context.storageState({ path: '${AUTH_FILE}' });
        console.log('Auth state saved to ${AUTH_FILE}');
        console.log('Now run: npm run test:e2e:record');
      } catch (e) {
        if (e.message.includes('connect')) {
          console.error('Could not connect to browser. Is it running?');
          console.error('Start it first: npm run test:e2e:browser');
        } else {
          console.error(e.message);
        }
        process.exit(1);
      }
    })();
  `;

  const child = spawn('node', ['-e', script], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  child.on('close', (code) => process.exit(code || 0));
} else if (CODEGEN_MODE) {
  // Launch playwright codegen with saved auth state
  const authExists = fs.existsSync(AUTH_FILE);

  console.log(`Launching playwright codegen...`);
  console.log(`  URL: ${url}`);
  console.log(`  Auth: ${authExists ? AUTH_FILE : 'none (run --save-auth first)'}\n`);

  const args = [
    'playwright', 'codegen',
    '--ignore-https-errors',
  ];

  if (authExists) {
    args.push(`--load-storage=${AUTH_FILE}`);
  } else {
    console.log('Tip: For authenticated sessions, run these steps:');
    console.log('  1. npm run test:e2e:browser  (login in browser)');
    console.log('  2. npm run test:e2e:save-auth');
    console.log('  3. npm run test:e2e:record\n');
  }

  args.push(url);

  const child = spawn('npx', args, {
    stdio: 'inherit',
    shell: true,
  });

  child.on('close', (code) => process.exit(code || 0));
} else {
  // Launch browser for manual testing
  console.log(`Launching browser...`);
  console.log(`  Executable: ${browserPath}`);
  console.log(`  Debug port: ${CDP_PORT}`);
  console.log(`  URL: ${url}`);
  console.log(`  User data: ${userDataDir}`);
  console.log(`\nLog into Confluence, then run: npm run test:e2e\n`);

  const child = spawn(browserPath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--ignore-certificate-errors',
    '--test-type',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  console.log(`Browser launched (PID: ${child.pid})`);
}
