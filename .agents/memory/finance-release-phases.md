---
name: Finance release phases
description: Defines Finance release-phase strictness and policy-consistent disposable verification.
---

Run the metadata-aware preflight before migration; missing Finance Core target tables and columns are expected then. Run the strict schema and ledger audit only after migration.

**Why:** Requiring the strict audit before its target schema existed caused expected missing-object queries to abort a PostgreSQL read-only transaction. Catching the SQL exception in JavaScript did not restore the transaction.

**How to apply:** Guard preflight checks with information-schema/catalog facts. For strict audit queries that can legitimately encounter optional schema errors, use a savepoint and roll back to it before continuing. Validate both phases on disposable PostgreSQL.

Exact billing-policy readiness guards and disposable PostgreSQL release fixtures must describe the same policy. Bundle-included service lines remain invoice evidence, but must not be treated as separate payable obligations in release scenarios.

**Why:** A stricter policy guard correctly blocked an outdated release fixture, and downstream assertions continued to assume included services were independently payable.

**How to apply:** When an effective price, bundle, or inclusion rule changes, update the disposable seed, invoice totals and lines, payable-category expectations, and payment-allocation fixtures together. Do not weaken readiness to preserve an obsolete fixture.