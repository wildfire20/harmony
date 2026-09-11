---
name: Parent learner isolation
description: Durable authorization and linking rules for the authenticated Parent Portal.
---

Every learner-specific Parent Portal operation must receive an explicit learner ID and verify that the learner is linked to the authenticated parent. Never silently fall back when an ID is missing, stale, or unauthorized. Zero-link accounts return safe empty states.

Parent-to-learner relationships must use stable user identifiers. Never infer or automatically relink relationships from names, phone numbers, or other non-unique enrollment details.

**Why:** Multi-learner selection previously displayed the chosen learner in the interface while several server requests returned the first linked learner. Name-based synchronization could also attach the wrong learner when identities collided.

**How to apply:** Enforce the rule on every learner-specific read, upload, payment, document, fee, and administrative linking path. When links change, clear stale client selections and use a currently authorized learner only.