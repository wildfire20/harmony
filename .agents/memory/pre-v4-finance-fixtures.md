---
name: Pre-v4 finance fixtures
description: Constraint compatibility when testing finance schemas before the billing-policy v4 migration.
---

When a disposable test intentionally stops finance migrations before v4 to verify old schema markers, seed service prices using only billing modes accepted by the pre-v4 CHECK constraint. Use `bundle_component` rather than `bundle` for the boarding row in that setup.

**Why:** The pre-v4 constraint rejects `bundle` before the population script can reach and report the intended schema-marker failure, so an otherwise valid marker test fails during fixture setup.

**How to apply:** Use the production `bundle` mode only after applying the v4 billing-policy migration. For old-marker tests, use a pre-v4-valid placeholder because marker verification must fail before price-contract validation.