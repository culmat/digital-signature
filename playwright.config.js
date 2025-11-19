const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const testConfig = require('./tests/e2e/utils/testConfig');
const fs = require('fs');

testConfig.validate();

const projects = [];
const allUsers = testConfig.getAllUsers();

allUsers.forEach((user, index) => {
  const userIndex = index + 1;
  const setupFile = path.join(__dirname, `tests/e2e/auth/user-${userIndex}.setup.js`);
  
  if (fs.existsSync(setupFile)) {
    projects.push({
      name: `setup-user-${userIndex}`,
      testMatch: `**/auth/user-${userIndex}.setup.js`,
    });
    
    projects.push({
      name: `user-${userIndex}`,
      testMatch: /.*\.spec\.js$/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, `tests/e2e/.auth/user-${userIndex}.json`),
      },
      dependencies: [`setup-user-${userIndex}`],
    });
  }
});

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: testConfig.timeout,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: testConfig.confluenceBaseUrl,
    headless: testConfig.headless,
    slowMo: testConfig.slowMo,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects,
});
