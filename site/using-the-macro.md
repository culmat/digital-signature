---
title: Using the Macro
description: Configuration reference and signing walkthrough.
section: digital-signature
order: 20
---

# Using the Macro

This page covers configuration (for page editors) and the signing experience (for signers).

## For page editors

### Contract title and content

| Field | Notes |
| --- | --- |
| **Contract Title** (`panelTitle`) | Displayed at the top of the panel. Part of the contract - changing it resets all signatures. Maximum 200 characters. |
| **Contract Content** (`content`) | The body of the contract. Supports limited Markdown (see below). Part of the contract - changing it resets all signatures. |

> **Content is the contract.** The title, body and page ID are used to uniquely identify the contract. If either changes, existing signatures no longer apply and signing starts over. This is intentional - it prevents signing a blank or altered document.

**Supported Markdown:**

    # Heading
    **bold**  *italic*
    - list items
    > blockquote
    `code`

External links and embedded images are not supported.

### Who can sign

By default (no restrictions configured), any logged-in user who can view the page can sign. This is called **petition mode** and the configuration panel will show a notice when it is active.

To restrict signing, use one or more of these options:

| Field | Description |
| --- | --- |
| **Signers** | Named Confluence users. Added via the user picker. |
| **Signer Groups** | Atlassian group IDs, one per line. Find group IDs in Atlassian Admin -> Groups. Note: these are group IDs (UUIDs), not group names. |
| **Allow page viewers to sign** (`inheritViewers`) | Any user with view permission on the page can sign. This is the key access-control feature: restrict the page and every authorized viewer automatically becomes a signer. **Does not include page editors** - use the editor option below to add them separately. |
| **Allow page editors to sign** (`inheritEditors`) | Any user with edit permission on the page can sign. This is a convenience option since editors can already change the signature settings. Especially useful in combination with the viewer option above to also include yourself or the team managing the page as signers. |

Multiple options can be combined - a user can sign if they match *any* of the configured restrictions.

> **Tip - combining viewers and editors:** Restrict your page to a set of viewers, enable "Allow page viewers to sign", and also enable "Allow page editors to sign" to include yourself (or the admin team) among the signers. Viewers and editors are treated as independent lists, so you can add or remove each group separately.

### Signing limits

| Field | Description |
| --- | --- |
| **Maximum Signatures** (`maxSignatures`) | Cap the total number of signatures accepted. Once reached, the Sign button disappears. Set to `0` to disable signing entirely. Leave empty for unlimited. |
| **Signature Display Limit** (`visibilityLimit`) | Show only the first N signatures; the rest are hidden behind a **Show more** button. Leave empty to always show all. |

### Visibility settings

These settings control who can see the lists of signers and pending signers.

| Setting | Options |
| --- | --- |
| **Show list of signers** (`signaturesVisible`) | `ALWAYS` - visible to everyone (default) |
|  | `IF_SIGNATORY` - only visible to users who can sign |
|  | `IF_SIGNED` - only visible to users who have already signed |
| **Show list of pending signers** (`pendingVisible`) | Same three options |

Visibility settings are independent for the signed list and the pending list.

## For signers

### How to sign

1. Open the Confluence page containing the macro.
2. If you are authorized to sign, a **Sign** button appears.
3. Click **Sign**, then confirm in the dialog. Signing cannot be undone.

You cannot sign the same contract twice. If the contract content changes, your previous signature is invalidated and you can sign again.

### When the Sign button appears

The button is shown if:

- You are listed as a named signer, **or**
- You are a member of one of the configured signer groups, **or**
- "Allow page viewers to sign" is enabled and you have view permission on the page (editors are **not** included - they must be enabled separately), **or**
- "Allow page editors to sign" is enabled and you have edit permission on the page, **or**
- No restrictions are set (petition mode - any logged-in user can sign)

and:

- The maximum signature count has not been reached
- You have not already signed this version of the contract

### Emailing signers

Two buttons in the macro panel let you compose an email to signers or pending signers:

- **Email signers** - opens your email client addressed to everyone who has signed
- **Email pending** - opens your email client addressed to everyone who has not yet signed

If the recipient list is too long for a mailto link, a dialog appears with the email addresses to copy and paste.

> Note: The app does not send emails automatically. It only helps you compose them.
