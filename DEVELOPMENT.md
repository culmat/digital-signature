# Forge Hello World

This project contains a Forge app written in Javascript that displays `Hello World!` in a Confluence macro with custom configuration.

See [developer.atlassian.com/platform/forge/](https://developer.atlassian.com/platform/forge) for documentation and tutorials explaining Forge.

## Requirements

See [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/) for instructions to get set up.

## Quick start

- Install nvm:

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
```
- Install node:

```
nvm install --lts
nvm use --lts
```

- Install forge:

```
npm install -g @forge/cli
```

- If needed configure forge to use a proxy:

Ensure `HTTP_PROXY=http://myproxy:1234` is set,
or use `GLOBAL_AGENT_HTTP_PROXY=http://myproxy:1234` instead of `GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=`

```
# Set the environment variable for global-agent
export GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=
echo 'export GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=' >> ~/.profile

# Install global-agent into the @forge/cli package (not globally)
FORGE_CLI_DIR=$(dirname $(dirname $(readlink -f $(which forge))))
npm install --prefix "$FORGE_CLI_DIR" global-agent

# Inject the global-agent bootstrap into the actual CLI script
FORGE_CLI="$FORGE_CLI_DIR/out/bin/cli.js"
if ! grep -q "global-agent/bootstrap" "$FORGE_CLI"; then
  sed -i "3i require('global-agent/bootstrap');" "$FORGE_CLI"
fi
```

- Install top-level dependencies:

```
npm install
```

- Modify your app frontend by editing the `src/frontend/index.jsx` file.

- Modify your app's configuration frontend by editing the `src/frontend/config.jsx` file.

- Modify your app backend by editing the `src/resolvers/index.js` file to define resolver functions. See [Forge resolvers](https://developer.atlassian.com/platform/forge/runtime-reference/custom-ui-resolver/) for documentation on resolver functions.

- Build and deploy your app by running:

```
forge deploy
```

- Install your app in an Atlassian site by running:

```
forge install
```

- Develop your app by running `forge tunnel` to proxy invocations locally:

```
forge tunnel
```

### Notes

- Use the `forge deploy` command when you want to persist code changes.
- Use the `forge install` command when you want to install the app on a new site.
- Once the app is installed on a site, the site picks up the new app changes you deploy without needing to rerun the install command.

## Testing

E2E tests use Playwright and connect to an existing browser where you're logged into Confluence.

1. Copy `e2e/.env.example` to `e2e/.env` and configure your instance.

2. Launch browser:

```
npm run test:e2e:browser
```

3. Log into Confluence in that browser.

4. Run tests:

```
npm run test:e2e
```
