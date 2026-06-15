#!/usr/bin/env bash
set -euo pipefail

# Creates test fixtures for CMA end-to-end testing on Confluence 10.
# Based on digital-signature-legacy/scripts/create-cma-test-fixtures.sh
# but uses space key CMA10 (to avoid conflict with v9 CMA space)
# and includes a signer group example.
#
# Usage: ./create-v10-test-fixtures.sh [base-url]
#   base-url defaults to http://localhost:10090

BASE_URL="${1:-http://localhost:10090}"
ADMIN_USER="admin"
ADMIN_PASS="admin"
AUTH="${ADMIN_USER}:${ADMIN_PASS}"
SPACE_KEY="CMA10"

# ── Helpers ──────────────────────────────────────────────────────────────────

api() {
    local method="$1" path="$2"; shift 2
    curl -s --user "$AUTH" \
        -H 'Content-Type: application/json' \
        -H 'Accept: application/json' \
        -X "$method" \
        "$@" \
        "${BASE_URL}${path}"
}

create_user() {
    local username="$1" fullname="$2" email="$3" password="${4:-test1234}"
    echo "  Creating user: ${username} (${email})"
    api POST "/rest/api/admin/user" \
        -d "{\"userName\":\"${username}\",\"fullName\":\"${fullname}\",\"email\":\"${email}\",\"password\":\"${password}\"}" \
        2>/dev/null || echo "    (user may already exist)"
}

create_group() {
    local groupname="$1"
    echo "  Creating group: ${groupname}"
    api POST "/rest/api/group" \
        -d "{\"name\":\"${groupname}\"}" \
        2>/dev/null || echo "    (group may already exist)"
}

add_to_group() {
    local groupname="$1" username="$2"
    echo "    Adding ${username} to group ${groupname}"
    api POST "/rest/api/group/${groupname}/member" \
        -d "{\"name\":\"${username}\"}" \
        2>/dev/null || echo "      (may already be a member)"
}

create_page() {
    local title="$1" body_storage="$2"
    echo "  Creating page: ${title}" >&2
    local payload
    payload=$(python3 -c "
import json, sys
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': '${SPACE_KEY}'},
    'body': {'storage': {'value': sys.argv[2], 'representation': 'storage'}}
}))
" "$title" "$body_storage")
    local response
    response=$(api POST "/rest/api/content" -d "$payload")
    local page_id
    page_id=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id', 'ERROR: ' + d.get('message','unknown')))" 2>/dev/null)
    if [[ "$page_id" == ERROR* ]]; then
        echo "    FAILED: ${page_id}" >&2
        echo ""
        return 1
    fi
    echo "    Page ID: ${page_id}" >&2
    echo "$page_id"
}

trigger_render() {
    local page_id="$1"
    curl -sf --user "$AUTH" \
        -H 'Accept: application/json' \
        "${BASE_URL}/rest/api/content/${page_id}?expand=body.view" > /dev/null
    echo "    Triggered render for page ${page_id}"
}

sign_as() {
    local username="$1" password="$2" sig_key="$3"
    echo "    Signing ${sig_key} as ${username}"
    curl -sf --user "${username}:${password}" \
        -L -o /dev/null \
        "${BASE_URL}/rest/signature/1.0/sign?key=${sig_key}" \
        2>/dev/null || echo "      WARNING: sign failed for ${username} on ${sig_key}"
}

# Build macro XHTML. Args: title, body, [extra params as key=value pairs]
macro_xhtml() {
    local title="$1" body="$2"; shift 2
    local xml='<ac:structured-macro ac:name="signature" ac:schema-version="1">'
    if [ -n "$title" ]; then
        xml+="<ac:parameter ac:name=\"title\">${title}</ac:parameter>"
    fi
    for param in "$@"; do
        local pname="${param%%=*}" pval="${param#*=}"
        xml+="<ac:parameter ac:name=\"${pname}\">${pval}</ac:parameter>"
    done
    xml+="<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body>"
    xml+='</ac:structured-macro>'
    echo "$xml"
}

# Compute signature key the same way Signature2.java does: sha256("pageId:title:body")
sig_key() {
    local page_id="$1" title="$2" body="$3"
    local hash
    hash=$(printf '%s' "${page_id}:${title}:${body}" | shasum -a 256 | awk '{print $1}')
    echo "signature.${hash}"
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "==> CMA Test Fixtures (Confluence 10)"
echo "    Target: ${BASE_URL}"
echo "    Space:  ${SPACE_KEY}"
echo ""

# Step 1: Create test users
echo "==> Step 1: Creating test users"
create_user "esther"  "Esther Lol"    "esther.l0l@mail.ch"
create_user "thomas"  "Thomas Lol"    "thomas.l0l@mail.ch"
create_user "unmapped" "Unmapped User" "nobody@example.invalid"
echo ""

# Step 2: Create signer group and add members
echo "==> Step 2: Creating signer group 'ds-signers'"
create_group "ds-signers"
add_to_group "ds-signers" "admin"
add_to_group "ds-signers" "esther"
add_to_group "ds-signers" "thomas"
echo ""

# Step 3: Create test space
echo "==> Step 3: Creating test space '${SPACE_KEY}'"
api POST "/rest/api/space" \
    -d "{\"key\":\"${SPACE_KEY}\",\"name\":\"CMA10 Migration Test\",\"description\":{\"plain\":{\"value\":\"Test data for CMA migration from Confluence 10\",\"representation\":\"plain\"}}}" \
    2>/dev/null || echo "  (space may already exist)"
echo ""

# Step 4: Create pages
echo "==> Step 4: Creating test pages"

# ── Page 1: Basic signed (wildcard group) ──
BODY1="I agree to NDA terms"
TITLE1="NDA"
MACRO1=$(macro_xhtml "$TITLE1" "$BODY1" "signerGroups=*")
PID1=$(create_page "Basic Signed Contract" "$MACRO1")

# ── Page 2: Multiple signers (wildcard group) ──
BODY2="We agree to the team rules"
TITLE2="Team Agreement"
MACRO2=$(macro_xhtml "$TITLE2" "$BODY2" "signerGroups=*")
PID2=$(create_page "Multiple Signers Contract" "$MACRO2")

# ── Page 3: Unsigned ──
BODY3="This contract is pending"
TITLE3="Pending Review"
MACRO3=$(macro_xhtml "$TITLE3" "$BODY3")
PID3=$(create_page "Unsigned Contract" "$MACRO3")

# ── Page 4: All parameters ──
BODY4="Complete test"
TITLE4="Full Config"
MACRO4=$(macro_xhtml "$TITLE4" "$BODY4" \
    "signerGroups=*" \
    "inheritSigners=readers and writers" \
    "maxSignatures=5" \
    "visibilityLimit=3" \
    "signaturesVisible=if signatory" \
    "pendingVisible=if signed" \
    "panel=true" \
    "protectedContent=false")
PID4=$(create_page "All Parameters Contract" "$MACRO4")

# ── Page 5: Named signer group (NEW — not wildcard) ──
BODY5="Only ds-signers group members may sign"
TITLE5="Group Contract"
MACRO5=$(macro_xhtml "$TITLE5" "$BODY5" "signerGroups=ds-signers")
PID5=$(create_page "Signer Group Contract" "$MACRO5")

# ── Page 6: Unicode ──
BODY6="Ägréément: äöü ñ 你好"
TITLE6="Ünïcödé Tëst"
MACRO6=$(macro_xhtml "$TITLE6" "$BODY6" "signerGroups=*")
PID6=$(create_page "Unicode Contract" "$MACRO6")

# ── Page 7: Two macros on one page ──
BODY7A="First contract body"
TITLE7A="First"
BODY7B="Second contract body"
TITLE7B="Second"
MACRO7A=$(macro_xhtml "$TITLE7A" "$BODY7A" "signerGroups=*")
MACRO7B=$(macro_xhtml "$TITLE7B" "$BODY7B" "signerGroups=*")
PID7=$(create_page "Two Macros One Page" "${MACRO7A}${MACRO7B}")

# ── Page 8: Markdown body ──
BODY8='## Heading
- item 1
- item 2

**bold** and *italic*

`code block`'
TITLE8="Markdown"
MACRO8=$(macro_xhtml "$TITLE8" "$BODY8" "signerGroups=*")
PID8=$(create_page "Markdown Body Contract" "$MACRO8")

echo ""

# Step 5: Trigger renders to create Bandana entries
echo "==> Step 5: Triggering macro renders"
for pid in "$PID1" "$PID2" "$PID3" "$PID4" "$PID5" "$PID6" "$PID7" "$PID8"; do
    pid_clean=$(echo "$pid" | tail -1)
    trigger_render "$pid_clean"
done
sleep 2
echo ""

# Step 6: Compute signature keys and sign contracts
echo "==> Step 6: Signing contracts"

PID1=$(echo "$PID1" | tail -1)
PID2=$(echo "$PID2" | tail -1)
PID3=$(echo "$PID3" | tail -1)
PID4=$(echo "$PID4" | tail -1)
PID5=$(echo "$PID5" | tail -1)
PID6=$(echo "$PID6" | tail -1)
PID7=$(echo "$PID7" | tail -1)
PID8=$(echo "$PID8" | tail -1)

KEY1=$(sig_key "$PID1" "$TITLE1" "$BODY1")
KEY2=$(sig_key "$PID2" "$TITLE2" "$BODY2")
# Page 3: unsigned — no signing
KEY4=$(sig_key "$PID4" "$TITLE4" "$BODY4")
KEY5=$(sig_key "$PID5" "$TITLE5" "$BODY5")
KEY6=$(sig_key "$PID6" "$TITLE6" "$BODY6")
KEY7A=$(sig_key "$PID7" "$TITLE7A" "$BODY7A")
KEY7B=$(sig_key "$PID7" "$TITLE7B" "$BODY7B")
KEY8=$(sig_key "$PID8" "$TITLE8" "$BODY8")

echo "  Page 1 (Basic): ${KEY1}"
sign_as admin admin "$KEY1"

echo "  Page 2 (Multiple):"
sign_as admin   admin    "$KEY2"
sign_as esther  test1234 "$KEY2"
sign_as thomas  test1234 "$KEY2"

echo "  Page 3 (Unsigned): skipped"

echo "  Page 4 (All params): ${KEY4}"
sign_as admin admin "$KEY4"

echo "  Page 5 (Signer Group - ds-signers): ${KEY5}"
sign_as admin   admin    "$KEY5"
sign_as esther  test1234 "$KEY5"

echo "  Page 6 (Unicode): ${KEY6}"
sign_as admin admin "$KEY6"

echo "  Page 7 (Two macros):"
sign_as admin admin "$KEY7A"
sign_as admin admin "$KEY7B"

echo "  Page 8 (Markdown): ${KEY8}"
sign_as admin admin "$KEY8"

echo ""

# Step 7: Verification summary
echo "==> Step 7: Verification summary"
echo ""
echo "  Pages created: 8"
echo "  Contracts expected: 9 (page 7 has 2 macros)"
echo "  Signatures expected:"
echo "    - admin:    8 signatures (all except page 3)"
echo "    - esther:   2 signatures (page 2 + page 5 signer group)"
echo "    - thomas:   1 signature  (page 2)"
echo "    - unmapped: 0 signatures (user exists but never signed)"
echo ""
echo "  Key test cases:"
echo "    - Page 1: Basic signed contract (wildcard group)"
echo "    - Page 2: Multiple signers"
echo "    - Page 3: Unsigned (no signatures to migrate)"
echo "    - Page 4: All Server parameters (inheritance, limits, visibility)"
echo "    - Page 5: Named signer group 'ds-signers' (NEW)"
echo "    - Page 6: Unicode title and body"
echo "    - Page 7: Two macros on one page"
echo "    - Page 8: Markdown body content"
echo ""
echo "  Space: ${BASE_URL}/display/${SPACE_KEY}"
echo ""
echo "==> Done! Test fixtures are ready for CMA migration."
