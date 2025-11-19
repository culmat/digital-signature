require('dotenv').config();

class TestConfig {
  constructor() {
    this.confluenceBaseUrl = process.env.CONFLUENCE_BASE_URL;
    this.confluenceEmail = process.env.CONFLUENCE_EMAIL;
    this.confluenceApiToken = process.env.CONFLUENCE_API_TOKEN;

    this.testSpacePrefix = process.env.TEST_SPACE_PREFIX || 'FORGETEST';
    this.cleanupAfterTests = process.env.CLEANUP_AFTER_TESTS !== 'false';

    this.headless = process.env.HEADLESS !== 'false';
    this.slowMo = parseInt(process.env.SLOW_MO || '0', 10);
    this.timeout = parseInt(process.env.TEST_TIMEOUT || '30000', 10);

    this.imapHost = process.env.TEST_IMAP_HOST || 'imap.gmail.com';
    this.imapPort = parseInt(process.env.TEST_IMAP_PORT || '993', 10);
  }

  validate() {
    const required = [
      { name: 'CONFLUENCE_BASE_URL', value: this.confluenceBaseUrl },
      { name: 'CONFLUENCE_EMAIL', value: this.confluenceEmail },
      { name: 'CONFLUENCE_API_TOKEN', value: this.confluenceApiToken }
    ];

    const missing = required.filter(({ value }) => !value);

    if (missing.length > 0) {
      const names = missing.map(({ name }) => name).join(', ');
      throw new Error(
        `Missing required environment variables: ${names}\n` +
        `Please create a .env file in the project root. See .env.example for reference.`
      );
    }
  }

  getUser(index) {
    const prefix = `TEST_USER_${index}_`;
    const email = process.env[`${prefix}EMAIL`];
    const password = process.env[`${prefix}PASSWORD`];
    const name = process.env[`${prefix}NAME`];
    const imapPassword = process.env[`${prefix}IMAP_PASSWORD`];

    if (!email || !password || !name) {
      throw new Error(
        `Test user ${index} not properly configured.\n` +
        `Required: ${prefix}EMAIL, ${prefix}PASSWORD, ${prefix}NAME\n` +
        `Please check your .env file.`
      );
    }

    const user = { email, password, name };

    if (imapPassword) {
      user.imap = {
        user: email,
        password: imapPassword,
        host: this.imapHost,
        port: this.imapPort
      };
    }

    return user;
  }

  getAllUsers() {
    const users = [];
    let index = 1;

    while (true) {
      const prefix = `TEST_USER_${index}_`;
      const email = process.env[`${prefix}EMAIL`];

      if (!email) {
        break;
      }

      try {
        users.push(this.getUser(index));
        index++;
      } catch (error) {
        console.warn(`Skipping user ${index}: ${error.message}`);
        break;
      }
    }

    return users;
  }

  getConfluenceConfig() {
    return {
      baseUrl: this.confluenceBaseUrl,
      email: this.confluenceEmail,
      apiToken: this.confluenceApiToken
    };
  }

  /**
   * Format: FORGETEST{TIMESTAMP}
   */
  generateTestSpaceKey() {
    const timestamp = Date.now().toString().slice(-6);
    return `${this.testSpacePrefix}${timestamp}`;
  }

  generateTestSpaceName(testName = '') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `Test Space - ${testName} - ${timestamp}`;
  }

  isCI() {
    return process.env.CI === 'true';
  }
}

module.exports = new TestConfig();
