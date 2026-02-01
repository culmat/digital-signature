/**
 * Custom Playwright reporter that displays test results as an AUI flag in the browser.
 * Also navigates back to the page that was open before tests started.
 */

const { chromium } = require('@playwright/test');
const { getAndClearInitialUrl } = require('../fixtures/browser');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';

class AuiFlagReporter {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.startTime = null;
  }

  onBegin() {
    this.startTime = Date.now();
  }

  onTestEnd(_test, result) {
    if (result.status === 'passed') this.passed++;
    else if (result.status === 'failed') this.failed++;
    else if (result.status === 'skipped') this.skipped++;
  }

  async onEnd() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const type = this.failed > 0 ? 'error' : 'success';

    let message;
    if (this.failed > 0) {
      message = `${this.failed} failed, ${this.passed} passed (${duration}s)`;
    } else {
      message = `${this.passed} passed (${duration}s)`;
    }

    try {
      const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
      const contexts = browser.contexts();
      const context = contexts[0];
      if (!context) return;

      const pages = context.pages();
      const page = pages[0];
      if (!page) return;

      // Navigate back to the page that was open before tests started
      const initialUrl = getAndClearInitialUrl();

      if (initialUrl) {
        await page.goto(initialUrl);
        await page.waitForLoadState('domcontentloaded');
      }

      // Wait for AJS to be available (Confluence's global JS object loads asynchronously)
      try {
        await page.waitForFunction(() => typeof AJS !== 'undefined' && AJS.flag, { timeout: 5000 });
      } catch {
        // AJS not available, will use fallback notification
      }

      // Display AUI flag with test results
      await page.evaluate(({ type, message }) => {
        if (typeof AJS !== 'undefined' && AJS.flag) {
          AJS.flag({
            type: type,
            title: 'E2E Test Results',
            body: message,
            close: 'auto'
          });
          return;
        }

        // Fallback: create a visible notification div styled like AUI flag
        const colors = {
          success: { bg: '#e3fcef', border: '#00875a', icon: '✓' },
          error: { bg: '#ffebe6', border: '#de350b', icon: '✗' }
        };
        const style = colors[type] || colors.success;

        const div = document.createElement('div');
        div.id = 'e2e-test-result';
        div.innerHTML = `
          <div style="
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 999999;
            background: ${style.bg};
            border: 2px solid ${style.border};
            border-radius: 8px;
            padding: 16px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 300px;
          ">
            <div style="font-weight: 600; margin-bottom: 4px;">
              ${style.icon} E2E Test Results
            </div>
            <div style="color: #172b4d;">${message}</div>
          </div>
        `;
        document.body.appendChild(div);

        // Auto-remove after 10 seconds
        setTimeout(() => div.remove(), 10000);
      }, { type, message });

    } catch {
      // Browser connection failed, skip notification
    }
  }
}

module.exports = AuiFlagReporter;
