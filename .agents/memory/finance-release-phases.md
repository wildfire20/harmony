---
name: Finance release phases
description: Distinguishes the Finance Core pre-migration preflight from the strict post-migration audit.
---

Run the metadata-aware preflight before migration; missing Finance Core target tables and columns are expected then. Run the strict schema and ledger audit only after migration.

**Why:** Requiring the strict audit before its target schema existed caused expected missing-object queries to abort a PostgreSQL read-only transaction. Catching the SQL exception in JavaScript did not restore the transaction.

**How to apply:** Guard preflight checks with information-schema/catalog facts. For strict audit queries that can legitimately encounter optional schema errors, use a savepoint and roll back to it before continuing. Validate both phases on disposable PostgreSQL.