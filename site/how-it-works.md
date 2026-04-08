---
title: How it works
description: Why signatures are immutable and why content lives in the macro.
section: digital-signature
order: 40
---

# How it works

This page explains why Digital Signature works the way it does and how it keeps signatures meaningful and tamper-proof.

## Why signatures are immutable

A signature has no legal or practical value if it can be withdrawn later or backdated. Once you sign, that fact is recorded permanently:

- You cannot unsign.
- The date cannot be changed.

This is the core property the app is built around.

## Why the contract lives inside the macro (not the page)

By putting the contract title and body inside the macro, we can hash the content and tie each signature to an exact version. If anything changes, the hash changes, and the existing signatures no longer apply and signing starts over.

This allows you to put explanations and signing instructions around the contract that can be edited without invalidating the signatures. You can also put several contracts on the same page.

Just ensure that the full text of the contract is contained within one single macro, so that the user exactly knows what is part of the contract.

This is also why you cannot give a [blank signature](https://www.merriam-webster.com/dictionary/blank%20signature): the macro requires real content before signing is possible.

Users sign only the macro content - not the page.

## Why content hashing (SHA-256)

Each contract is identified by a SHA-256 hash of its title, body, and the page it lives on. This means:

- Copying a macro to a different page produces a different hash - the old signatures do not transfer.
- Restoring a page to a previous version with the same content restores the same hash - the signatures reappear.
- Two identical macros on the same page share a hash - signing one signs both.

## Why Markdown (not the rich text editor)

Rich text in Confluence can include dynamic content, embedded macros, and formatting that may render differently across page loads or browser environments. That instability makes it impossible to guarantee the content is the same from one load to the next.

Markdown with a restricted feature set (no external links, no embedded images, no HTML) is stable, portable, and unambiguous. The same source always produces the same output.

External links and embedded images are specifically excluded because they allow a page author to change what a reader sees by updating the linked resource - without changing the hash.

## The wiki tension

Wikis are built on the principle that anyone can edit anything at any time. Digital signatures require the opposite: a frozen document that cannot change after signing.

Digital Signature integrates both with ease. The macro is a small enclave of immutability inside an otherwise fluid wiki. Outside the macro, the page works normally. Inside it, signatures are tied to the exact content.
