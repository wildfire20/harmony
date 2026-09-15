# Finance Core Safe Deployment Order

This is an operator runbook. Application startup does not apply the finance
core migration, and this sequence must stop before migration when a preflight
or audit reports a finding.

## 1. Disposable PostgreSQL release gate

Run the full release gate against the disposable Finance Core test database.

**Never point `FINANCE_TEST_DATABASE_URL` at production.**

## 2. Production pre-migration preflight

Run only the preflight against the intended production database/schema:

```sh
npm run preflight:finance-core
```

This command is read-only and is designed for the schema that exists before
the Finance Core migration. Missing Finance Core target tables and columns are
expected at this phase and are not blockers. Resolve missing prerequisite base
tables/columns, canonical monthly duplicate identities when the target identity
columns already exist, invalid persisted billing periods/origins when those
columns already exist, overlapping active enrollments when that table already
exists, and conflicting database object names before continuing.

**Stop here if preflight fails.** Do not run the migration to discover
whether it can repair the data; the migration does not guess historical
periods, delete evidence, or repair duplicates.

## 3. Backup/checkpoint

Create and verify an operator-owned database backup/checkpoint, including the
finance tables and invoice/payment evidence. Record the backup identifier,
database/schema, release revision, and UTC timestamp. Do not continue unless
the backup is confirmed restorable according to the organization’s procedure.

## 4. Operator-run migration

After the clean preflight and verified checkpoint, an authorized operator
applies `migrations/finance_core_architecture.sql` using the migration runner
for the target database. The migration is atomic, takes its advisory lock,
and performs its own duplicate guard before creating the canonical monthly
unique index.

If it fails, stop. Do not bypass the guard, manually delete or rewrite
invoice/payment evidence, or deploy the application against a partial result.
Investigate and rerun the read-only audit/preflight after the database is
restored to a known state.

## 5. Post-migration audit and preflight

Run both commands again:

```sh
npm run audit:finance-core
npm run preflight:finance-core
```

The strict post-migration audit must confirm the schema version, immutable payment
and invoice-line triggers, canonical invoice projection-context trigger,
deferred proof consistency triggers, enrollment exclusion constraint, and
canonical monthly identity index. The preflight must remain clean.

**Stop here if either command fails.**

## 6. Deploy application code

Only after the post-migration audit is clean may the release be deployed.
Startup performs a read-only finance readiness check and fails finance routes
closed when the migration is absent; it is not a substitute for this order.

## 7. Controlled production finance verification

After deployment, perform the approved read-only and controlled finance
verification. Do not create, approve, reverse, reallocate, or reconcile
production finance records outside the authorized verification procedure.
