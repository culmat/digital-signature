const { test, expect } = require('./fixtures/confluenceFixture');

test.describe('Confluence API Tests (No Browser)', () => {
  test('should create and access a test space', async ({ confluenceApi, testSpace }) => {
    expect(testSpace).toBeDefined();
    expect(testSpace.key).toMatch(/^FORGETEST\d+$/);

    const retrievedSpace = await confluenceApi.getSpace(testSpace.key);
    expect(retrievedSpace.key).toBe(testSpace.key);
  });

  test('should create a test page', async ({ confluenceApi, testSpace }) => {
    const page = await confluenceApi.createPage(
      testSpace.key,
      'Test Page',
      '<p>Test content</p>'
    );

    expect(page.id).toBeDefined();
    expect(page.title).toBe('Test Page');

    const retrieved = await confluenceApi.getPage(page.id);
    expect(retrieved.id).toBe(page.id);
  });

  test('should create page with macro', async ({ confluenceApi, testSpace }) => {
    const macroXml = confluenceApi.createMacroXml('digital-signature', {
      panelTitle: 'Test Contract'
    });

    const pageBody = `<p>Test page with macro:</p>${macroXml}`;
    const page = await confluenceApi.createPage(testSpace.key, 'Macro Test', pageBody);

    expect(page.id).toBeDefined();

    const retrieved = await confluenceApi.getPage(page.id);
    expect(retrieved.body.storage.value).toContain('digital-signature');
  });

  test('should get current user', async ({ confluenceApi }) => {
    const user = await confluenceApi.getCurrentUser();
    expect(user.accountId).toBeDefined();
    expect(user.email).toBeDefined();
  });
});
