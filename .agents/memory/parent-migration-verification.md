---
name: Parent migration verification
description: Rules for safely converging legacy Parent Portal schemas and reporting migration success.
---

Parent Portal migrations must account for schema objects previously created by server startup. `IF NOT EXISTS` only checks object presence or names; it does not normalize legacy column metadata or recognize semantically equivalent indexes and constraints.

Manual migration runners must verify the intended phase using the same structural verifier as the production preflight, on the same database client and before commit. They report success only after verification, commit, and cleanup succeed.

**Why:** A legacy push-subscription table used compatible but textually different types and generated constraint names. Name-only index checks also misclassified valid GIN indexes, while unverified runners reported success after SQL execution alone.

**How to apply:** Reconcile uniqueness and relationships semantically, avoid duplicate equivalent indexes, accept safe legacy-equivalent types where conversion is riskier, and keep compatibility repairs additive, idempotent, and separate from business-data changes.