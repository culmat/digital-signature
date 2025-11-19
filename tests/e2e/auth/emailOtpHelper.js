const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');

/**
 * Extracts one-time verification codes from Atlassian emails.
 * Polls email inbox via IMAP to retrieve verification codes sent during login.
 */
class EmailOtpHelper {
  constructor(imapConfig) {
    this.email = imapConfig.user;
    this.host = imapConfig.host || 'imap.gmail.com';
    this.port = imapConfig.port || 993;
    this.password = imapConfig.password;

    if (!this.password) {
      throw new Error(
        'IMAP password required for authentication.\n' +
        'Set TEST_USER_X_IMAP_PASSWORD in .env'
      );
    }
  }

  async buildImapConfig() {
    return {
      user: this.email,
      password: this.password,
      host: this.host,
      port: this.port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  }

  /**
   * Extracts verification code from email body (HTML or text)
   * @param {string} emailBody - Email HTML or text content
   * @returns {string|null} Extracted verification code or null
   */
  extractVerificationCode(emailBody) {
    if (!emailBody) {
      return null;
    }

    const searchSpaces = [];

    if (/<[a-z\-]+[\s\S]*>/i.test(emailBody)) {
      try {
        const $ = cheerio.load(emailBody);
        const bodyText = $('body').text();
        if (bodyText) {
          searchSpaces.push(bodyText);
        }
        $('p, strong, b, span').each((_, element) => {
          const text = $(element).text();
          if (text) {
            searchSpaces.push(text);
          }
        });
      } catch (error) {
        console.warn('Failed to parse HTML email body for verification code extraction', error.message);
      }
    }

    searchSpaces.push(emailBody);

    for (const candidate of searchSpaces) {
      const code = this.findCodeInText(candidate);
      if (code) {
        return code;
      }
    }

    return null;
  }

  findCodeInText(rawText) {
    if (!rawText) {
      return null;
    }

    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) {
      return null;
    }

    const patterns = [
      /enter the following code:\s*([A-Z0-9]{6})/i,
      /verification code is[:\s]+([A-Z0-9]{6})/i,
      /code is[:\s]+([A-Z0-9]{6})/i,
      /code:[:\s]+([A-Z0-9]{6})/i,
      /([A-Z0-9]{6})\s+You are receiving/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && this.isValidCode(match[1])) {
        return match[1].toUpperCase();
      }
    }

    if (/(code|verification|otp)/i.test(text)) {
      const genericMatches = text.match(/\b[A-Z0-9]{6}\b/g) || [];
      for (const candidate of genericMatches) {
        if (this.isValidCode(candidate)) {
          return candidate.toUpperCase();
        }
      }
    }

    return null;
  }

  isValidCode(value) {
    if (!value) {
      return false;
    }
    const code = value.trim().toUpperCase();
    if (code === 'ATLASS') {
      return false;
    }
    return /^[A-Z0-9]{6}$/.test(code);
  }

  /**
   * Polls email inbox for Atlassian verification code
   * @param {number} timeoutMs - Maximum time to wait for email (default: 30000ms)
   * @param {number} checkIntervalMs - Interval between checks (default: 2000ms)
   * @returns {Promise<string>} Verification code
   * @throws {Error} If code not found within timeout
   */
  async getVerificationCode(timeoutMs = 30000, checkIntervalMs = 2000) {
    const startTime = Date.now();
    let attemptNumber = 0;

    console.log(`Polling email inbox for Atlassian verification code (${timeoutMs}ms timeout)...`);
    console.log(`IMAP: ${this.email}@${this.host}:${this.port}`);

    while (Date.now() - startTime < timeoutMs) {
      attemptNumber++;
      const elapsed = Date.now() - startTime;
      console.log(`[Attempt ${attemptNumber}] Checking inbox (elapsed: ${elapsed}ms)...`);

      try {
        const code = await this.checkForNewVerificationEmail();
        if (code) {
          console.log(`✓ Verification code received: ${code} (after ${elapsed}ms)`);
          return code;
        }
        console.log(`[Attempt ${attemptNumber}] No verification email found yet`);
      } catch (error) {
        const isFatalError = error.message.includes('Invalid credentials') ||
                            error.message.includes('authentication failed') ||
                            error.message.includes('AUTHENTICATIONFAILED') ||
                            error.message.includes('Login failed');

        if (isFatalError) {
          console.error(`✗ Fatal IMAP error - cannot retry: ${error.message}`);
          throw new Error(
            `IMAP authentication failed: ${error.message}\nCheck TEST_USER_X_IMAP_PASSWORD in .env file`
          );
        }

        console.warn(`[Attempt ${attemptNumber}] Email check failed: ${error.message}`);
      }

      await this.sleep(checkIntervalMs);
    }

    throw new Error(`Verification code not received within ${timeoutMs}ms timeout (${attemptNumber} attempts)`);
  }

  /**
   * Connects to IMAP and checks for recent Atlassian verification emails
   * @param {number} connectionTimeoutMs - IMAP connection timeout (default: 10000ms)
   * @returns {Promise<string|null>} Verification code if found, null otherwise
   */
  async checkForNewVerificationEmail(connectionTimeoutMs = 10000) {
    const operationStartTime = Date.now();

    const imapConfig = await this.buildImapConfig();

    const imapCheckPromise = new Promise((resolve, reject) => {
      const imap = new Imap(imapConfig);
      let resolved = false;

      const safeResolve = (value) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const safeReject = (error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      };

      console.log(`  → Connecting to IMAP server...`);

      imap.once('ready', () => {
        const connectTime = Date.now() - operationStartTime;
        console.log(`  → IMAP connected (${connectTime}ms)`);

        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            console.error(`  ✗ Failed to open INBOX: ${err.message}`);
            imap.end();
            return safeReject(err);
          }

          console.log(`  → INBOX opened (${box.messages.total} total messages)`);

          const fiveMinutesAgo = new Date();
          fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

          const searchCriteria = [
            'UNSEEN',
            ['FROM', 'atlassian.com'],
            ['SINCE', fiveMinutesAgo]
          ];

          console.log(`  → Searching: UNSEEN FROM atlassian.com SINCE ${fiveMinutesAgo.toISOString()}`);

          imap.search(searchCriteria, (err, results) => {
            if (err) {
              console.error(`  ✗ Search failed: ${err.message}`);
              imap.end();
              return safeReject(err);
            }

            if (!results || results.length === 0) {
              console.log(`  → No matching emails found`);
              imap.end();
              return safeResolve(null);
            }

            console.log(`  → Found ${results.length} unread email(s) from Atlassian`);

            const fetch = imap.fetch(results, { bodies: '', markSeen: true });
            let emailsProcessed = 0;
            let foundCode = false;
            const pendingParsing = [];

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                const parsingPromise = new Promise((resolveParser) => {
                  simpleParser(stream, (err, parsed) => {
                    if (err) {
                      console.error(`  ✗ Email parsing failed: ${err.message}`);
                      resolveParser();
                      safeReject(err);
                      return;
                    }

                    emailsProcessed++;
                    const subject = parsed.subject || '';
                    const from = parsed.from?.text || 'unknown';

                    console.log(`  → Email ${emailsProcessed}: "${subject}" from ${from}`);

                    if (!subject.toLowerCase().includes('verification') &&
                        !subject.toLowerCase().includes('code') &&
                        !subject.toLowerCase().includes('verifying')) {
                      console.log(`  → Skipping email (subject doesn't match verification patterns)`);
                      resolveParser();
                      return;
                    }

                    const emailBody = parsed.html || parsed.text || '';
                    const code = this.extractVerificationCode(emailBody);

                    if (code) {
                      const totalTime = Date.now() - operationStartTime;
                      console.log(`  ✓ Verification code extracted: ${code} (operation took ${totalTime}ms)`);
                      foundCode = true;
                      imap.end();
                      safeResolve(code);
                    } else {
                      console.log(`  → No verification code found in email body`);
                      console.log(`  → Body preview: ${emailBody.substring(0, 200)}...`);
                    }
                    resolveParser();
                  });
                });
                pendingParsing.push(parsingPromise);
              });
            });

            fetch.once('error', (err) => {
              console.error(`  ✗ Fetch error: ${err.message}`);
              imap.end();
              safeReject(err);
            });

            fetch.once('end', async () => {
              await Promise.all(pendingParsing);

              const totalTime = Date.now() - operationStartTime;
              console.log(`  → Fetch completed (${totalTime}ms, ${emailsProcessed} emails processed)`);

              if (!foundCode) {
                imap.end();
                safeResolve(null);
              }
            });
          });
        });
      });

      imap.once('error', (err) => {
        console.error(`  ✗ IMAP error: ${err.message}`);
        safeReject(err);
      });

      imap.once('end', () => {
        const totalTime = Date.now() - operationStartTime;
        console.log(`  → IMAP connection closed (${totalTime}ms)`);
      });

      console.log(`  → Initiating IMAP connection...`);
      imap.connect();
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`IMAP operation timed out after ${connectionTimeoutMs}ms`));
      }, connectionTimeoutMs);
    });

    return Promise.race([imapCheckPromise, timeoutPromise]);
  }

  /**
   * Helper to sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = EmailOtpHelper;
