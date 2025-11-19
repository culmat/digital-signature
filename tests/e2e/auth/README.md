# Playwright Authentication Setup

This directory contains authentication setup scripts for Playwright tests against Confluence Cloud.

## IMAP Email OTP Authentication

For email verification during login, configure IMAP password authentication:

```env
TEST_USER_1_IMAP_PASSWORD=your_imap_password
TEST_IMAP_HOST=imap.mail.ch
TEST_IMAP_PORT=993
```
✅ Simple to set up
✅ Works with most email providers
✅ No additional configuration needed

---

## Overview

Authentication uses **session state persistence** to avoid re-authenticating on every test run:
1. Setup scripts authenticate once and save session cookies to `.auth/` directory
2. All tests load saved session state (fast, no login required)
3. Sessions remain valid for ~2 weeks (Confluence Cloud default)
4. Automatic session validation before each test

## Files

- **user.setup.js** - Authenticates test users, saves to `.auth/user-{index}.json`
- **emailOtpHelper.js** - Extracts email verification codes via IMAP (for 2FA)

## Initial Setup

### 1. Configure Test Accounts

Add credentials to your `.env` file:

```bash
# Test users (add as many as needed)
TEST_USER_1_EMAIL=user1@example.com
TEST_USER_1_PASSWORD=your_password_here
TEST_USER_1_NAME=Test User 1
TEST_USER_1_IMAP_PASSWORD=imap_app_password_1

TEST_USER_2_EMAIL=user2@example.com
TEST_USER_2_PASSWORD=your_password_here
TEST_USER_2_NAME=Test User 2
```

### 2. Configure Email OTP (If 2FA Enabled)

If your test accounts have 2FA/email verification enabled, configure IMAP access for each user:

```bash
# Shared IMAP configuration
TEST_IMAP_HOST=imap.gmail.com
TEST_IMAP_PORT=993

# Per-user IMAP passwords
TEST_USER_1_IMAP_PASSWORD=imap_app_password_1
TEST_USER_2_IMAP_PASSWORD=imap_app_password_2
```

**Note**: For Gmail, you need:
1. 2-Step Verification enabled
2. App Password generated (not your regular password)
3. IMAP access enabled in Gmail settings

### 3. Authenticate Users

Run setup scripts to create initial sessions:

```bash
# Authenticate all configured users
npx playwright test --project=setup-user
```

This creates session files for each configured user:
- `tests/e2e/.auth/user-1.json` (user 1 session)
- `tests/e2e/.auth/user-2.json` (user 2 session)
- etc.

## Running Tests

Once authenticated, run tests normally:

```bash
# Run all tests (uses saved sessions)
npx playwright test
```

## Session Expiry

Sessions typically last 2 weeks. If a test fails with "Session validation failed":

```bash
# Re-authenticate the expired user
npx playwright test --project=setup-user

# Or delete session files to force re-authentication
rm tests/e2e/.auth/user-*.json
npx playwright test  # Will trigger setup automatically
```

## How It Works

### Session State Files

`.auth/*.json` files contain:
- Session cookies (`cloud.session.token`, `tenant.session.token`)
- XSRF tokens
- Local storage data
- Device fingerprint (for "trust this device")

These are **sensitive files** and are gitignored.

### Email OTP Flow

When Atlassian sends an email verification code:

1. Setup script detects OTP input field
2. `emailOtpHelper.js` polls your email inbox via IMAP
3. Extracts verification code from Atlassian email
4. Auto-fills code and submits
5. Session saved with "trusted device" flag

### Session Validation

Before each test, `sessionValidator.js`:
1. Checks if session file exists
2. Verifies cookies are not expired
3. Tests session by navigating to Confluence
4. Confirms user menu is visible (authenticated state)
5. Throws error if session invalid

## Troubleshooting

### "Session validation failed"
- Session expired → Re-run setup script
- Cookies cleared manually → Re-authenticate
- IP address changed significantly → May trigger new OTP

### "Email OTP required but IMAP credentials not configured"
- Add IMAP credentials to `.env`
- Or manually enter code within 30 seconds
- Or disable 2FA on test accounts (recommended)

### "Failed to retrieve verification code"
- Check IMAP credentials are correct
- Verify email account can receive Atlassian emails
- Check email isn't delayed (try again in 1 minute)
- Ensure no other process is marking emails as read

### Tests fail with "user menu not found"
- Session likely invalid
- Delete `.auth/*.json` and re-authenticate
- Check test account still has Confluence access

