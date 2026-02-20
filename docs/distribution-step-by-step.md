# Distribution Step by Step

Publishing the Digital Signature Forge app on the Atlassian Marketplace.

## Prerequisites

Before starting, ensure you have:

- [x] A vendor account at [marketplace.atlassian.com](https://marketplace.atlassian.com/)
- [x] The app deployed and tested on a development site
- [x ] An Atlassian Developer Community account (at least one contact registered)

## Step 1: Prepare Legal Documents

The app uses the [Bonterms Standard End User Agreement (v1.0)](https://www.atlassian.com/licensing/marketplace/end-user-agreement-v1) with Provider-Specific Terms. No separate DPA is needed because all data stays within the Atlassian Forge platform.

### End User Terms (Provider-Specific Terms)

Hosted at: [https://culm.at/digital-signature/terms.html](https://culm.at/digital-signature/terms.html)

Adopts the Bonterms Standard Agreement via the Marketplace UI. Provider-Specific Terms cover governing law (Switzerland), support policy, data processing scope, and acceptable use disclaimer.

### Privacy Policy

Hosted at: [https://culm.at/digital-signature/privacy.html](https://culm.at/digital-signature/privacy.html)

Covers what data is stored (account IDs, timestamps, page IDs, content hashes), what is NOT stored (no names, emails, tracking), and how GDPR is handled (Atlassian standard mechanisms apply).

### Data Processing Addendum

Not required. The app runs entirely on Forge. Data never leaves Atlassian's infrastructure. Atlassian's own DPA with the customer covers data processing.

**Action items:**
- [x] End User Terms hosted at culm.at
- [x] Privacy Policy hosted at culm.at
- [x] DPA — not applicable (Forge-only app)

## Step 2: Prepare Branding Materials

The Marketplace listing requires visual assets.

### Required

- **App logo** — Square image, per Atlassian branding specs
- **App description** — Clear explanation of what the app does

### Recommended (especially for paid apps)

- **Banner image** — Header graphic for the listing page
- **Screenshots** — Show the macro in action (signing, config, admin)
- **Demo video** — Short walkthrough showing the problem and solution

### Branding Rules

- Do NOT start the app name with an Atlassian product name (e.g., "Confluence Digital Signature" is rejected)
- Use the format "Digital Signature for Confluence" instead
- Do not use Atlassian logos, colors, or brand elements in your assets
- Do not use domains that could be confused with Atlassian (e.g., `atlassian.yourdomain.com`)

**Action items:**
- [ ] Create app logo
- [ ] Write listing description
- [ ] Take screenshots of the macro (signing view, config panel, admin page)
- [ ] Record a short demo video (optional but recommended)

## Step 3: Prepare Documentation

Your listing must reference documentation describing how to set up and use the app.

- Installation and first-use guide
- Configuration options (signers, groups, limits, visibility)
- Admin features (backup, restore, statistics)
- FAQ or troubleshooting section

Host the documentation at a public URL (e.g., a dedicated Confluence space, a docs site, or a GitHub wiki).

**Action items:**
- [ ] Write user-facing documentation
- [ ] Host at a stable public URL

## Step 4: Enable Licensing in the Manifest

If the app will be paid (or free with a license), add licensing to `manifest.yml`:

```yaml
app:
  id: ari:cloud:ecosystem::app/bab5617e-dc42-4ca8-ad38-947c826fe58c
  licensing:
    enabled: true
```

Important consequences of enabling licensing:
- Once deployed to production with licensing enabled, the app **cannot be installed from production** until the Marketplace listing is approved
- Production installations of paid apps **trigger billing automatically**, even for your own test sites
- Always test paid-app behavior in the **development or staging** environment

### Test License States

Before submitting, verify the app behaves correctly under all license states:

```bash
# Install with different license states in development
forge install --environment development --license active
forge install --environment development --license inactive
forge install --environment development --license trial
```

Or set a persistent override:

```bash
forge variables set -e development LICENSE_OVERRIDE active
forge variables set -e development LICENSE_OVERRIDE inactive
```

The `license` object is only present in the production environment for paid apps. In development/staging, use the overrides above.

**Action items:**
- [ ] Add `licensing.enabled: true` to manifest.yml (if paid)
- [ ] Test with active, inactive, and trial license states
- [ ] Verify the app degrades gracefully when the license is inactive

## Step 5: Deploy to Production

Deploy the final version to the production environment:

```bash
forge deploy -e production
```

Verify the deployment succeeded:

```bash
forge environments
```

**Action items:**
- [ ] Deploy to production
- [ ] Verify deployment status

## Step 6: Prepare Security Information

Atlassian requires detailed security information during submission. Prepare answers for:

### API Scope Justifications

For each scope in your `manifest.yml`, explain why it is needed:

| Scope | Justification |
|-------|---------------|
| `read:confluence-user` | Resolve signer display names |
| `read:confluence-content.all` | Read page restrictions for permission inheritance |
| `read:confluence-content.summary` | Read page metadata for lifecycle events |
| `write:confluence-content` | Required by Forge macro module |
| `storage:app` | App storage access (Forge SQL) |
| `read:user:confluence` | Read current user context for authorization |
| `read:email-address:confluence` | Fetch email addresses for mailto links |

### External Requests

List all remote hostnames your app contacts and why. If the app only uses Forge APIs and Confluence REST APIs (no egress), state that explicitly.

### Privacy and Security Tab

Cloud apps must disclose:
- Whether the app requires Personal Access Tokens (no)
- Justification for each permission
- Optional: Link to a Trust Center page

**Action items:**
- [ ] Prepare scope justifications (table above)
- [ ] Document external request destinations (if any)
- [ ] Prepare Privacy and Security tab answers

## Step 7: Complete KYC/KYB Verification

Since 2025, all new app submissions require identity verification through a third-party vendor.

Process:
1. After submitting your app, you receive a verification ticket
2. Provide business information (company name, registration, address)
3. Provide personal information (identity of the submitting individual)
4. Complete individual and business verification via the vendor platform

This is a one-time requirement for new app submissions. Updates do not require re-verification.

Timeline: 2-3 business days.

**Action items:**
- [ ] Have business registration documents ready
- [ ] Have personal identification ready
- [ ] Complete verification when prompted

## Step 8: Submit the Listing

1. Go to [marketplace.atlassian.com/manage/apps/create](https://marketplace.atlassian.com/manage/apps/create)
2. Accept the Marketplace Partner Agreement
3. Fill out the listing form:
   - **App name**: "Digital Signature for Confluence" (not "Confluence Digital Signature")
   - **Summary**: One-line description
   - **Description**: Detailed feature overview
   - **Category**: Select the most relevant category
   - **Pricing**: Free or paid (with tier pricing if paid)
   - **Compatibility**: Auto-detected from manifest
   - **End User Terms URL**: Link to your Terms of Service
   - **Privacy Policy URL**: Link to your Privacy Policy
   - **Documentation URL**: Link to your user docs
   - **Support contact**: Email, ticketing system, or phone
   - **Logo and screenshots**: Upload prepared assets
4. Complete the Privacy and Security tab
5. Provide scope justifications and egress details
6. For paid apps: supply bank account details for payouts
7. Click "Submit for approval"

**Action items:**
- [ ] Complete and submit the listing form
- [ ] Double-check all URLs are live and accessible

## Step 9: Wait for Review

Atlassian reviews new submissions within **5-10 business days**. The review covers:

- **Function**: Does the app work as advertised?
- **Security**: Automated vulnerability scanning; critical and high-severity issues must be resolved
- **Performance**: No significant impact on Confluence performance
- **Branding**: Compliance with naming and asset guidelines
- **Documentation**: Setup and usage docs are accessible

If issues are found, Atlassian will request changes. Fix and resubmit. Errors in submission cause delays, so get it right the first time.

## Step 10: Post-Approval Verification

Once approved:

1. Visit your listing on the Marketplace and verify it looks correct
2. Test installation from the Marketplace on a clean site
3. Verify all listing links work (docs, privacy policy, terms)
4. Confirm the app functions correctly when installed from Marketplace
5. Check your vendor financial information is complete (for paid apps)

## After Launch

### Version Updates

Routine version updates (bug fixes, features) do **not** require re-approval. Just deploy and publish:

```bash
forge deploy -e production
```

Re-approval is only needed for:
- Changing payment model (free → paid)
- Adding a cloud version to an existing server listing
- Changing the app's base URL

### Monitoring

- Check reviews on your listing regularly
- Respond to user feedback
- Monitor installation and usage metrics in the Partner Portal
- Keep documentation up to date

### Testing After Listing

Once listed, you cannot install the production app via installation links. To test:
- Use the development or staging environment
- Or create a separate unlicensed copy of the app for internal testing

## Resources

- [Distribute your apps](https://developer.atlassian.com/platform/forge/distribute-your-apps/)
- [List a Forge app](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)
- [Create your app listing](https://developer.atlassian.com/platform/marketplace/creating-a-marketplace-listing/)
- [App approval guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/)
- [Security workflow for app approval](https://developer.atlassian.com/platform/marketplace/app-approval-security-workflow/)
- [List and manage apps](https://developer.atlassian.com/platform/marketplace/listing-and-managing-apps/)
