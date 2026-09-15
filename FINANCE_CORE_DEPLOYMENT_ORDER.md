# Finance Core Safe Deployment Order

This is an operator runbook. Application startup does not apply the finance
core migration, and this sequence must stop before migration when a preflight
or audit reports a finding.

## 1. Read-only audit and preflight

Run against the intended database/schema with the release code:

```sh
npm run audit:finance-core
npm run preflight:finance-core
```

Both commands are read-only. They must report no errors or blockers. In
particular, resolve canonical monthly duplicate identities, invalid persisted
billing periods/origins, overlapping active enrollments, missing base tables,
and conflicting database object names before continuing.

**Stop here if either command fails.** Do not run the migration to discover
whether it can repair the data; the migration does not guess historical
periods, delete evidence, or repair duplicates.

## 2. Backup/checkpoint

Create and verify an operator-owned database backup/checkpoint, including the
finance tables and invoice/payment evidence. Record the backup identifier,
database/schema, release revision, and UTC timestamp. Do not continue unless
the backup is confirmed restorable according to the organization’s procedure.

## 3. Operator-run migration

After the clean preflight and verified checkpoint, an authorized operator
applies `migrations/finance_core_architecture.sql` using the migration runner
for the target database. The migration is atomic, takes its advisory lock,
and performs its own duplicate guard before creating the canonical monthly
unique index.

If it fails, stop. Do not bypass the guard, manually delete or rewrite
invoice/payment evidence, or deploy the application against a partial result.
Investigate and rerun the read-only audit/preflight after the database is
restored to a known state.

## 4. Post-migration audit

Run both commands again:

```sh
npm run audit:finance-core
npm run preflight:finance-core
```

The post-migration audit must confirm the schema version, immutable payment
and invoice-line triggers, canonical invoice projection-context trigger,
deferred proof consistency triggers, enrollment exclusion constraint, and
canonical monthly identity index. The preflight must remain clean.

## 5. Deploy application code

Only after the post-migration audit is clean may the release be deployed.
Startup performs a read-only finance readiness check and fails finance routes
closed when the migration is absent; it is not a substitute for this order.
