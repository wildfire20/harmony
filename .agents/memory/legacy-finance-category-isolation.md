---
name: Legacy finance category isolation
description: Safety rule for historical payments that predate persisted allocation categories.
---

Partially paid multi-service invoices without persisted category allocation events must not offer service-specific payment choices or infer which service was previously paid.

**Why:** Aggregate invoice balances cannot prove whether a historical payment covered tuition, transport, boarding, or another line. Guessing can misapply a later payment and corrupt reconciliation.

**How to apply:** Mark these invoices for Admin review and keep Parent category selection fail-closed. Only audited Admin reconciliation may establish category ownership; do not reconstruct it from current enrollment flags, prices, or notes.