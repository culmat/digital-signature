const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage } = require('../helpers/confluence-client');
const { generateMacroStorageFormat } = require('../fixtures');
const { extractPdfText, extractWordText } = require('../helpers/export-parser');
const path = require('path');
const fs = require('fs');

// Test configuration from environment
const TEST_SPACE = process.env.TEST_SPACE;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

// Store created page info for cleanup
let createdPageId = null;

// Comprehensive markdown content covering all supported and excluded features
const MARKDOWN_CONTENT = `# Heading Level 1
## Heading Level 2
### Heading Level 3
#### Heading Level 4
##### Heading Level 5
###### Heading Level 6

This paragraph has **bold text** and *italic text* and ~~strikethrough text~~ and \`inline code\`.

- Unordered item one
- Unordered item two
- Unordered item three

1. Ordered item one
2. Ordered item two
3. Ordered item three

> This is a blockquote with some text

---

\`\`\`javascript
const codeBlock = "example";
console.log(codeBlock);
\`\`\`

This contains a [link text here](https://example.com) that should be plain text.

This contains an ![image alt text](https://example.com/img.png) that should be plain text.`;

test.describe('Markdown Formatting', () => {
  test.beforeAll(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    getCredentials(); // Validates credentials are available
  });

  test.afterAll(async ({ browser }) => {
    if (createdPageId) {
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      if (!page.url().includes('/wiki')) {
        await page.goto(`${BASE_URL}/wiki`);
      }

      await deleteTestPage(page, createdPageId);
      console.log(`Deleted test page: ${createdPageId}`);
    }
  });

  test('renders all supported markdown formatting correctly', async ({ page }) => {
    // Navigate to Confluence (needed for API calls)
    await page.goto(`${BASE_URL}/wiki`);

    // Generate and create test page with comprehensive markdown content
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Markdown Formatting Test',
      content: MARKDOWN_CONTENT,
    });
    const title = `E2E-Markdown-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Navigate to the created test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for the macro to load (Sign button indicates macro is ready)
    await expect(page.getByRole('button', { name: 'Sign' })).toBeVisible({ timeout: 15000 });

    // Verify headings are rendered
    await expect(page.getByText('Heading Level 1')).toBeVisible();
    await expect(page.getByText('Heading Level 2')).toBeVisible();
    await expect(page.getByText('Heading Level 3')).toBeVisible();
    await expect(page.getByText('Heading Level 4')).toBeVisible();
    await expect(page.getByText('Heading Level 5')).toBeVisible();
    await expect(page.getByText('Heading Level 6')).toBeVisible();

    // Verify inline formatting text is visible
    await expect(page.getByText('bold text')).toBeVisible();
    await expect(page.getByText('italic text')).toBeVisible();
    await expect(page.getByText('strikethrough text')).toBeVisible();
    await expect(page.getByText('inline code')).toBeVisible();

    // Verify unordered list items
    await expect(page.getByText('Unordered item one')).toBeVisible();
    await expect(page.getByText('Unordered item two')).toBeVisible();
    await expect(page.getByText('Unordered item three')).toBeVisible();

    // Verify ordered list items (use exact match to avoid matching "Unordered item one")
    await expect(page.getByText('Ordered item one', { exact: true })).toBeVisible();
    await expect(page.getByText('Ordered item two', { exact: true })).toBeVisible();
    await expect(page.getByText('Ordered item three', { exact: true })).toBeVisible();

    // Verify blockquote content
    await expect(page.getByText('This is a blockquote with some text')).toBeVisible();

    // Verify code block content
    await expect(page.getByText('const codeBlock = "example"')).toBeVisible();
  });

  test('handles excluded elements (links and images) as plain text', async ({ page }) => {
    // This test reuses the page created in the previous test
    // Navigate to the test page if not already there
    if (createdPageId) {
      const currentUrl = page.url();
      if (!currentUrl.includes(createdPageId)) {
        await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${createdPageId}`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Sign' })).toBeVisible({ timeout: 15000 });
      }
    }

    // Verify link text appears as plain text (not as a clickable link)
    await expect(page.getByText('link text here')).toBeVisible();

    // Verify there is NO anchor element with this text within the macro
    // The macro content is inside an iframe or specific container
    const linkAnchors = page.locator('a').filter({ hasText: 'link text here' });
    await expect(linkAnchors).toHaveCount(0);

    // Verify image alt text appears as plain text (not as an image)
    await expect(page.getByText('image alt text')).toBeVisible();

    // Verify there is NO img element with this alt text
    const images = page.locator('img[alt="image alt text"]');
    await expect(images).toHaveCount(0);
  });

  test('exports contain correct markdown content in Word and PDF', async ({ page, downloadDir }) => {
    // Extended timeout for PDF generation (~2 minutes)
    test.setTimeout(180000);

    // Create our own test page if needed (makes test self-contained)
    let testPageId = createdPageId;
    if (!testPageId) {
      await page.goto(`${BASE_URL}/wiki`);
      const storageBody = generateMacroStorageFormat({
        panelTitle: 'Export Test',
        content: MARKDOWN_CONTENT,
      });
      const title = `E2E-Export-${Date.now()}`;
      const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
      testPageId = testPage.id;
      createdPageId = testPageId; // Store for cleanup
      console.log(`Created test page for export: ${testPage.id}`);
    }

    // Navigate to the test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPageId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Sign' })).toBeVisible({ timeout: 15000 });

    // Clean up any existing files in download directory before starting
    const existingFiles = fs.readdirSync(downloadDir);
    for (const f of existingFiles) {
      if (f.endsWith('.doc') || f.endsWith('.pdf')) {
        fs.unlinkSync(path.join(downloadDir, f));
        console.log(`Cleaned up existing file: ${f}`);
      }
    }

    // Helper to wait for a file with given extension to appear in download dir
    async function waitForDownload(extension, timeout = 30000) {
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const currentFiles = fs.readdirSync(downloadDir).filter(f => f.endsWith(extension));

        if (currentFiles.length > 0) {
          const filePath = path.join(downloadDir, currentFiles[0]);
          // Wait a moment for file to finish writing
          await new Promise(r => setTimeout(r, 1000));
          console.log(`Found download: ${currentFiles[0]}`);
          return filePath;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // Debug: list what files exist
      const finalFiles = fs.readdirSync(downloadDir);
      console.log(`Timeout! Files in ${downloadDir}: ${finalFiles.join(', ') || '(empty)'}`);
      throw new Error(`Timeout waiting for ${extension} file in ${downloadDir}`);
    }

    // Export to Word - downloads go directly to downloadDir via CDP config
    console.log(`Download directory: ${downloadDir}`);
    await page.getByTestId('object-header-actions-container')
      .getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Export to Word' }).click();

    // Wait for .doc file to appear
    const wordPath = await waitForDownload('.doc');
    console.log(`Word file downloaded: ${wordPath}`);

    // Verify Word content
    const wordText = extractWordText(wordPath);
    expect(wordText).toContain('Heading Level 1');
    expect(wordText).toContain('Unordered item one');
    expect(wordText).toContain('link text here');
    expect(wordText).not.toContain('https://example.com'); // URL should not appear

    // Cleanup Word file
    fs.unlinkSync(wordPath);

    // Export to PDF
    await page.getByTestId('object-header-actions-container')
      .getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Export to PDF' }).click();
    await page.getByRole('link', { name: 'Download PDF' }).click();

    // Wait for .pdf file to appear (can take up to 2 minutes)
    const pdfPath = await waitForDownload('.pdf', 150000);
    console.log(`PDF file downloaded: ${pdfPath}`);

    // Verify PDF content
    const pdfText = await extractPdfText(pdfPath);
    expect(pdfText).toContain('Heading Level 1');
    expect(pdfText).toContain('Unordered item one');
    expect(pdfText).toContain('link text here');
    expect(pdfText).not.toContain('https://example.com'); // URL should not appear

    // Cleanup PDF file
    fs.unlinkSync(pdfPath);
  });
});
