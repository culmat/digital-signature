# digital-signature

A digital signature macro for [Atlassian Confluence](https://www.atlassian.com/software/confluence)

## Description

Allows confluence users to write contracts in a confluence macro which can be signed directly by logged-in users.

- content and signatures can not be modified once signed
- white list users who can sign
- report when and by whom the contract was signed
- easily send email to signers of the contract
- receive notifications, when your contract has been signed

## Privacy Policy

- We do not transfer or store any data outside your Atlassian product.
- We have no access to any data you stored within your Atlassian product.
- Your data is yours - no strings attached.
- The plugin is [fully open source](https://github.com/culmat/digital-signature/) and anybody can audit it anytime.

## Installation & Usage

Install via [Atlassian Marketplace](https://marketplace.atlassian.com/plugins/tbd).

We hope you love the plugin, trust us and find the license fee fair. If not you can [install and run](https://github.com/culmat/digital-signature/blob/main/DEVELOPMENT.md) it on your own under the terms of the AGPL license without a fee. Don't forget to make [pull requests](https://github.com/culmat/digital-signature/pulls) for your contributions. Sharing is caring ❤️.

You are also welcome to choose your own price and [support my open source developemnt with any amount](https://liberapay.com/culmat/).

A detailed description of the available configuration fields and usage is described in
the [Wiki...](https://github.com/culmat/digital-signature/wiki/tbd)

## Compatability

Digital-signature is written for Confluence Cloud. In fact it's a complete rewrite of https://github.com/baloise/digital-signature/ which is the version for server ( and data center) Confluence instances.

TBD : implement & describe migration

## Feature overview

### Sign

- Set signers, title, notified users and layout of the contract
- One click approval. User management is done by Confluence.
- The signature remains valid only as long the title and body are the same as at the time of signature.

## Contribute

Every contribution is welcome, in particular [issue reports](https://github.com/culmat/digital-signature/issues) and [pull requests](https://github.com/culmat/digital-signature/pulls).

## Credits

This macro was written by [Matthias Cullmann](@culmat).

## License

This project is licensed under the [AGPLV3 or later](https://github.com/culmat/digital-signature/blob/main/LICENSE).
