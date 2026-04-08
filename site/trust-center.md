---
title: Trust Center
description: Security, data practices, privacy, compliance, and support.
section: digital-signature
order: 60
---

# Trust Center

Digital Signature for Confluence is designed with a minimal footprint: it stores only what is strictly necessary to record signatures, runs entirely within Atlassian's infrastructure, and gives customers full control over their data.

## Platform & Architecture

The app is built on [Atlassian Forge](https://developer.atlassian.com/platform/forge/), Atlassian's serverless cloud platform. This means:

- All code runs inside Atlassian's infrastructure - there are no external servers operated by the Provider
- The app makes no outbound network calls to third-party services
- All data remains within your Atlassian instance's hosting environment
- The Provider has no access to customer data at runtime

## Data Stored

All data is stored in **Forge SQL**, a per-installation relational database hosted and managed by Atlassian. Each Confluence site gets its own isolated database.

| Data | Purpose |
| --- | --- |
| Atlassian account IDs | Identify who signed a document. Opaque platform identifiers - not names or email addresses. |
| Signature timestamps | Record when each signature was made. |
| Confluence page IDs | Associate signatures with the correct page. |
| SHA-256 content hashes | Verify document integrity. If content changes, signatures are invalidated. |

### What is NOT stored

- No names, email addresses, or other personal information
- No tracking data, analytics, or telemetry
- No cookies
- No data is transmitted to the Provider or any external service

Email addresses are fetched on-demand from the Confluence API when a user clicks **Email signers** or **Email pending signers**. They are used to build a `mailto:` link in the browser and are never stored by the app.

## Security

Security is provided by the Atlassian Forge platform:

- **Database isolation** - each Confluence installation has its own Forge SQL database; data from one site cannot be accessed by another
- **Encrypted storage** - Atlassian encrypts data at rest and in transit as part of the Forge platform
- **No Provider access** - the Provider cannot query or read customer databases at runtime
- **Forge sandbox** - Forge restricts what the app can do at the platform level; outbound network calls require explicit allowlist approval from Atlassian

## Privacy & GDPR

The app processes only Atlassian account IDs, which are opaque platform identifiers managed by Atlassian - not personal data that the Provider controls.

- **Data subject requests (DSAR)** - handled via standard Atlassian mechanisms; no separate request to the Provider is needed
- **Right to erasure** - Atlassian's erasure processes apply to account IDs stored by this app automatically
- **No Data Processing Addendum required** - Atlassian acts as data processor for all data on the Forge platform under [Atlassian's DPA](https://www.atlassian.com/legal/data-processing-addendum)
- **No third-party data sharing** - the app shares no data with third parties

See the [Privacy Policy](privacy-policy.html) for the full data practices statement.

## Data Residency

Data residency is governed entirely by Atlassian's platform. Customers who have configured a data residency region for their Atlassian products benefit from that configuration automatically.

See [Atlassian's data residency documentation](https://www.atlassian.com/trust/privacy/data-residency) for details on supported regions and how to configure them.

## Data Retention & Deletion

- When a Confluence page is **moved to trash**, associated signatures are soft-deleted (marked for removal)
- When a page is **permanently deleted**, all associated signatures are permanently removed
- Admins can also export and restore data via the Admin Dashboard's backup feature

## Compliance

- **Atlassian Marketplace** - the app is listed on the Atlassian Marketplace and subject to Atlassian's partner and security review process
- **Forge security model** - the app operates under Atlassian's Forge sandbox, which enforces capability-based access controls at the platform level
- **Acceptable use** - the app is intended for documenting acknowledgment and agreement within Confluence pages. It does not provide legally binding electronic signatures in the sense of eIDAS, ESIGN, or similar regulations. Do not use this app as a substitute for qualified electronic signatures where required by law.

## Support

| | |
| --- | --- |
| Email | <culm@culm.at> |
| Issue Tracker | [Known issues](https://github.com/culmat/digital-signature/issues) |
| Business hours | Mon-Fri, 09:00-17:00 CET |
| Response SLA | 5 business days |

## Legal

| Document | Description |
| --- | --- |
| [Privacy Policy](privacy-policy.html) | What data is collected, how it is stored, GDPR rights |
| [Terms](terms.html) | End user terms, governing law (Swiss law / Basel-Stadt), support terms |
