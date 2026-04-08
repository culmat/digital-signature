---
title: Privacy Policy
description: What data is collected, where it is stored, and GDPR rights.
section: digital-signature
order: 70
---

# Privacy Policy

**Digital Signature for Confluence**

## Provider and Contact

| | |
| --- | --- |
| Name | Matthias Cullmann |
| Contact | <culm@culm.at> |
| Website | [culm.at](https://culm.at) |

## How the App Works

Digital Signature for Confluence is a Confluence Cloud macro that allows users to sign documents within Confluence pages. The app runs entirely on the [Atlassian Forge](https://developer.atlassian.com/platform/forge/) platform.

## What Data Is Stored

The app stores the following data in Forge SQL (a per-installation database hosted by Atlassian):

| Data | Purpose |
| --- | --- |
| Atlassian account IDs | Identify who signed a document. These are opaque platform identifiers, not names or email addresses. |
| Signature timestamps | Record when each signature was made. |
| Confluence page IDs | Associate signatures with the correct page. |
| SHA-256 content hashes | Verify document integrity. If content changes, a new signature round starts. |

## What Data Is NOT Stored

- No names, email addresses, or other personal information
- No tracking data, analytics, or telemetry
- No cookies
- No data is sent to external services

Email addresses may be fetched on-demand from the Confluence API when a user clicks "Email signers" or "Email pending signers". These addresses are used to build a `mailto:` link in the browser and are never stored by the app.

## Where Data Is Stored

All data is stored within the Atlassian Forge platform in per-installation databases. The Provider does not operate any servers or infrastructure outside of Atlassian's platform. Data never leaves Atlassian's infrastructure. The Provider has no access to customer data at runtime.

Data residency is governed entirely by [Atlassian's data residency policies](https://www.atlassian.com/trust/privacy/data-residency).

## Data Retention and Deletion

- When a Confluence page is moved to trash, associated signatures are soft-deleted (marked for removal).
- When a page is permanently deleted, all associated signatures are permanently removed.
- Site administrators can delete all signature data at any time via the app's admin dashboard.
- Site administrators can export and restore data via the admin dashboard's backup and restore feature.

## GDPR and Data Subject Rights

The app only stores Atlassian account IDs, which are opaque platform identifiers assigned by Atlassian. The app does not process personal data beyond what Atlassian already manages as part of its platform.

All standard Atlassian mechanisms for data residency, data subject access requests (DSAR), and right-to-erasure work out of the box. When Atlassian processes a data subject request, it applies to the account IDs stored by this app as well.

No separate Data Processing Addendum is required. Atlassian acts as the data processor for all data stored on the Forge platform. The data processing relationship between Atlassian and the customer is governed by [Atlassian's Data Processing Addendum](https://www.atlassian.com/legal/data-processing-addendum).

## Third Parties

The app does not share data with any third parties. The app does not make external API calls. All processing occurs within the Atlassian Forge platform.

## Changes to This Policy

This policy may be updated to reflect changes in the app's functionality or applicable regulations. The "Last updated" date below indicates when the most recent revision was made.

## Contact

For questions about this privacy policy or the app's data practices, contact <culm@culm.at>.

---

*Last updated: 19 February 2026*
