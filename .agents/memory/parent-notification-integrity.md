---
name: Parent notification integrity
description: Security and transaction rules for durable Parent Portal notifications and optional delivery channels.
---

Durable Parent Portal notifications are the source of truth. Every record belongs to an authenticated parent, and learner-related visibility and actions must be rechecked against the parent's current learner links.

Use stable event identities and database uniqueness for deduplication. Email and browser push are optional delivery channels and must never create duplicate durable records or roll back attendance, academic, invoice, payment, announcement, or document transactions.

Notification destinations must be internal Parent Portal routes from a strict allowlist. Learner-specific actions select only a currently authorized linked learner before navigating.

**Why:** Client-selected parent or learner IDs, arbitrary redirects, retry-created duplicates, and delivery failures can expose another learner's information or make important school records unreliable.

**How to apply:** Derive the parent from the Phase 2 session, validate current learner links in list/read/action flows, commit source records first, and process safe preview delivery independently.