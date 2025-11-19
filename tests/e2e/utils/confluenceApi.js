const fetch = require('node-fetch');

class ConfluenceApiClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.authHeader = 'Basic ' + Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    this.apiUrl = `${this.baseUrl}/rest/api`;
  }

  async request(method, endpoint, body = null) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`;

    const options = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Confluence API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async getCurrentUser() {
    return this.request('GET', '/user/current');
  }

  async createSpace(key, name) {
    const spaceData = {
      key,
      name,
      description: {
        plain: {
          value: 'Test space for digital signature macro E2E tests',
          representation: 'plain'
        }
      },
      metadata: {}
    };
    try {
      const space = await this.request('POST', '/space', spaceData);
      return space;
    } catch (error) {
      if (error.message.includes('409') || error.message.includes('ConstraintViolationException')) {
        return this.getSpace(key);
      }
      throw error;
    }
  }

  async getSpace(spaceKey) {
    return this.request('GET', `/space/${spaceKey}`);
  }

  async deleteSpace(spaceKey) {
    try {
      await this.request('DELETE', `/space/${spaceKey}`);
    } catch (error) {
      if (!error.message.includes('404')) {
        throw error;
      }
    }
  }

  async createPage(spaceKey, title, htmlInStorageFormat, parentId = null) {
    const pageData = {
      type: 'page',
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: htmlInStorageFormat,
          representation: 'storage'
        }
      }
    };
    if (parentId) {
      pageData.ancestors = [{ id: parentId }];
    }
    const page = await this.request('POST', '/content', pageData);
    return page;
  }

  async deletePage(pageId) {
    try {
      await this.request('DELETE', `/content/${pageId}`);
    } catch (error) {
      if (!error.message.includes('404')) {
        throw error;
      }
    }
  }

  createMacroXml(macroName, keyValuePairsForMacroParameters = {}, bodyContent = '') {
    const params = Object.entries(keyValuePairsForMacroParameters)
      .map(([key, value]) => `<ac:adf-parameter key="${key}">${value}</ac:adf-parameter>`)
      .join('');

    const body = bodyContent ? `<ac:adf-content>${bodyContent}</ac:adf-content>` : '';

    return `
      <ac:adf-extension>
        <ac:adf-node type="bodied-extension">
          <ac:adf-attribute key="extension-key">dc8dc7af-20f3-4ef1-bf5a-137dd0982545/80a8c9f6-a4ba-4630-81bc-cde9a2585298/static/${macroName}-confluence-cloud-culmat</ac:adf-attribute>
          <ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute>
          <ac:adf-attribute key="parameters">
            ${params}
          </ac:adf-attribute>
          ${body}
        </ac:adf-node>
      </ac:adf-extension>
    `;
  }

  async getPage(pageId, commaSeparatedFieldsToExpand = 'body.storage,version,space') {
    return this.request('GET', `/content/${pageId}?expand=${commaSeparatedFieldsToExpand}`);
  }

  async updatePage(pageId, title, htmlInStorageFormat) {
    const currentPage = await this.getPage(pageId);
    const newVersion = currentPage.version.number + 1;

    const pageData = {
      version: {
        number: newVersion
      },
      title,
      type: 'page',
      body: {
        storage: {
          value: htmlInStorageFormat,
          representation: 'storage'
        }
      }
    };

    return this.request('PUT', `/content/${pageId}`, pageData);
  }
}

module.exports = ConfluenceApiClient;

