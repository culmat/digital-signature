#!/usr/bin/env python3
"""Convert migrated Server macros to Forge ADF format on Confluence Cloud.

CMA dev mode migrates pages but doesn't convert the macro storage format.
Server macros use <ac:structured-macro> with <ac:parameter> elements.
Forge macros use <ac:adf-extension> with <ac:adf-node>/<ac:adf-parameter>.

This script converts all signature macros in a given space from Server to
Forge ADF format, including parameter name normalization.

Usage:
  python3 scripts/rewrite-cma-macros.py <cloud-host> <space-key> [--env-id ID]

Example:
  python3 scripts/rewrite-cma-macros.py cul.atlassian.net CMA
  python3 scripts/rewrite-cma-macros.py cul.atlassian.net CMA --env-id 3db24628-d68b-465a-8bfd-ffb0aae164b4

Requires: FORGE_EMAIL and FORGE_API_TOKEN in e2e/.env or environment.
"""

import argparse
import base64
import json
import os
import re
import ssl
import sys
from html import unescape
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

# App identifiers
APP_ID = 'bab5617e-dc42-4ca8-ad38-947c826fe58c'
MACRO_KEY = 'digital-signature'
DEFAULT_PROD_ENV_ID = '3db24628-d68b-465a-8bfd-ffb0aae164b4'

# inheritSigners enum → boolean flags
INHERIT_MAP = {
    'none':                (False, False),
    'readers only':        (True,  False),
    'writers only':        (False, True),
    'readers and writers': (True,  True),
}

VISIBILITY_UPPER = {
    'always':       'ALWAYS',
    'if signatory': 'IF_SIGNATORY',
    'if signed':    'IF_SIGNED',
}

# Regex to match a full <ac:structured-macro> block for our macro
MACRO_RE = re.compile(
    r'<ac:structured-macro\s+ac:name="(?:signature|digital-signature)"[^>]*>'
    r'(.*?)'
    r'</ac:structured-macro>',
    re.DOTALL,
)

PARAM_RE = re.compile(
    r'<ac:parameter\s+ac:name="([^"]+)">(.*?)</ac:parameter>',
    re.DOTALL,
)

BODY_RE = re.compile(
    r'<ac:plain-text-body><!\[CDATA\[(.*?)\]\]></ac:plain-text-body>',
    re.DOTALL,
)


def load_env():
    for env_file in [Path(__file__).resolve().parent.parent / 'e2e' / '.env']:
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    os.environ.setdefault(key.strip(), value.strip())


def api_request(url, auth, method='GET', data=None):
    headers = {
        'Accept': 'application/json',
        'Authorization': 'Basic ' + base64.b64encode(auth.encode()).decode(),
    }
    if data is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(data).encode()
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, context=SSL_CTX) as resp:
        return json.loads(resp.read())


def escape_xml(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def parse_server_macro(inner_xml):
    """Extract parameters and body from a Server macro's inner XML."""
    params = {}
    for m in PARAM_RE.finditer(inner_xml):
        params[m.group(1)] = unescape(m.group(2))

    body_match = BODY_RE.search(inner_xml)
    body = body_match.group(1) if body_match else ''

    return params, body


def build_forge_adf(params, body, env_id):
    """Build a Forge ADF extension block from extracted Server parameters."""
    local_id = str(uuid4())
    extension_key = f'{APP_ID}/{env_id}/static/{MACRO_KEY}'
    extension_id = f'ari:cloud:ecosystem::extension/{extension_key}'

    title = escape_xml(params.get('title', ''))
    content = escape_xml(body)

    # signers
    signers_raw = params.get('signers', '')
    if signers_raw:
        signers_vals = ''.join(
            f'<ac:adf-parameter-value>{escape_xml(s.strip())}</ac:adf-parameter-value>'
            for s in signers_raw.split(',') if s.strip()
        )
    else:
        signers_vals = '<ac:adf-parameter-value />'

    # signer groups
    groups_raw = params.get('signerGroups', '')
    if groups_raw:
        groups_vals = ''.join(
            f'<ac:adf-parameter-value>{escape_xml(g.strip())}</ac:adf-parameter-value>'
            for g in groups_raw.split(',') if g.strip()
        )
    else:
        groups_vals = '<ac:adf-parameter-value />'

    # inheritSigners → inherit-viewers + inherit-editors
    inherit = params.get('inheritSigners', 'none').lower()
    inherit_viewers, inherit_editors = INHERIT_MAP.get(inherit, (False, False))

    # Optional numeric params
    optional = ''
    for server_key, adf_key in [('maxSignatures', 'max-signatures'), ('visibilityLimit', 'visibility-limit')]:
        val = params.get(server_key)
        if val is not None and val != '' and val != '-1':
            try:
                n = int(val)
                if n != -1:
                    optional += f'<ac:adf-parameter key="{adf_key}" type="number">{n}</ac:adf-parameter>'
            except ValueError:
                pass

    # Detect locked Server macros: no signers, no groups (or groups != "*"), no inheritance
    # On Server, these macros were NOT signable. On Cloud, empty config = petition mode.
    # Set max-signatures to 0 to preserve the locked behavior.
    is_locked = (
        not signers_raw
        and (not groups_raw or groups_raw.strip() != '*')
        and not inherit_viewers
        and not inherit_editors
    )
    if is_locked and 'max-signatures' not in optional:
        optional += '<ac:adf-parameter key="max-signatures" type="number">0</ac:adf-parameter>'

    # Optional enum params
    for server_key, adf_key in [('signaturesVisible', 'signatures-visible'), ('pendingVisible', 'pending-visible')]:
        val = params.get(server_key)
        if val:
            upper = VISIBILITY_UPPER.get(val.lower(), val)
            optional += f'<ac:adf-parameter key="{adf_key}">{upper}</ac:adf-parameter>'

    return (
        f'<ac:adf-extension>'
        f'<ac:adf-node type="extension">'
        f'<ac:adf-attribute key="extension-key">{extension_key}</ac:adf-attribute>'
        f'<ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute>'
        f'<ac:adf-attribute key="parameters">'
        f'<ac:adf-parameter key="local-id">{local_id}</ac:adf-parameter>'
        f'<ac:adf-parameter key="extension-id">{extension_id}</ac:adf-parameter>'
        f'<ac:adf-parameter key="extension-title">{MACRO_KEY}</ac:adf-parameter>'
        f'<ac:adf-parameter key="render">native</ac:adf-parameter>'
        f'<ac:adf-parameter key="guest-params">'
        f'<ac:adf-parameter key="title">{title}</ac:adf-parameter>'
        f'<ac:adf-parameter key="content">{content}</ac:adf-parameter>'
        f'<ac:adf-parameter key="signers">{signers_vals}</ac:adf-parameter>'
        f'<ac:adf-parameter key="signer-groups">{groups_vals}</ac:adf-parameter>'
        f'<ac:adf-parameter key="inherit-viewers" type="boolean">{str(inherit_viewers).lower()}</ac:adf-parameter>'
        f'<ac:adf-parameter key="inherit-editors" type="boolean">{str(inherit_editors).lower()}</ac:adf-parameter>'
        f'{optional}'
        f'</ac:adf-parameter>'
        f'</ac:adf-attribute>'
        f'<ac:adf-attribute key="text">{MACRO_KEY}</ac:adf-attribute>'
        f'<ac:adf-attribute key="layout">default</ac:adf-attribute>'
        f'<ac:adf-attribute key="local-id">{local_id}</ac:adf-attribute>'
        f'</ac:adf-node>'
        f'</ac:adf-extension>'
    )


def convert_macro(match, env_id):
    """Regex replacement function: convert one Server macro to Forge ADF."""
    inner_xml = match.group(1)
    params, body = parse_server_macro(inner_xml)
    return build_forge_adf(params, body, env_id)


def main():
    parser = argparse.ArgumentParser(description='Convert CMA-migrated Server macros to Forge ADF format')
    parser.add_argument('cloud_host', help='Cloud site hostname (e.g. cul.atlassian.net)')
    parser.add_argument('space_key', help='Confluence space key (e.g. CMA)')
    parser.add_argument('--env-id', default=DEFAULT_PROD_ENV_ID,
                        help=f'Forge environment ID (default: {DEFAULT_PROD_ENV_ID})')
    args = parser.parse_args()

    base_url = f'https://{args.cloud_host}/wiki'
    load_env()

    email = os.environ.get('FORGE_EMAIL')
    token = os.environ.get('FORGE_API_TOKEN')
    if not email or not token:
        print('Error: FORGE_EMAIL and FORGE_API_TOKEN must be set')
        sys.exit(1)
    auth = f'{email}:{token}'

    print(f'==> Converting macros in space {args.space_key} on {args.cloud_host}')
    print(f'    Server format → Forge ADF (env-id: {args.env_id})')
    print()

    # Fetch all pages
    pages_data = api_request(
        f'{base_url}/rest/api/content?spaceKey={args.space_key}&limit=100&expand=version',
        auth,
    )
    pages = pages_data['results']

    total = rewritten = skipped = 0

    for page in pages:
        page_id = page['id']
        version = page['version']['number']
        title = page['title']
        total += 1

        body_data = api_request(
            f'{base_url}/rest/api/content/{page_id}?expand=body.storage',
            auth,
        )
        body = body_data['body']['storage']['value']

        if not MACRO_RE.search(body):
            print(f'  - {page_id} {title} (no server macro)')
            skipped += 1
            continue

        new_body = MACRO_RE.sub(lambda m: convert_macro(m, args.env_id), body)
        new_version = version + 1

        try:
            api_request(
                f'{base_url}/rest/api/content/{page_id}',
                auth,
                method='PUT',
                data={
                    'id': page_id,
                    'type': 'page',
                    'title': title,
                    'version': {'number': new_version},
                    'body': {
                        'storage': {
                            'value': new_body,
                            'representation': 'storage',
                        }
                    },
                },
            )
            macro_count = len(MACRO_RE.findall(body))
            locked_note = ' [LOCKED: max-signatures=0]' if 'max-signatures" type="number">0' in new_body else ''
            print(f'  ✓ {page_id} {title} ({macro_count} macro(s), v{version} → v{new_version}){locked_note}')
            rewritten += 1
        except HTTPError as e:
            err_body = e.read().decode()[:200]
            print(f'  ✗ {page_id} {title} — HTTP {e.code}: {err_body}')

    print()
    print(f'==> Done: {total} pages, {rewritten} converted, {skipped} skipped')


if __name__ == '__main__':
    main()
