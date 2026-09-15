---
name: Canonical finance core
description: Durable authority and rollout rules for current/future billing, payment commands, proof allocations, and legacy isolation.
---

Current and future billing must use effective-dated service enrollments and immutable invoice snapshots. Immutable payment/allocation events are authoritative; invoice totals and statuses are guarded projections. Every finance write, including monthly billing, proofs, manual payments, bank imports, credits, reversals, carry-forward, and arrears, must pass through the canonical transactional command layer.

**Why:** Multiple schema generations, route-owned accounting algorithms, JSON-only proof proposals, current Boolean service flags, and competing header/ledger calculations caused recurring Parent/Admin/export discrepancies and made one fix expose another.

**How to apply:** Persist exact period, invoice, line, fee-assignment, category, and amount identities. New proof proposals use normalized relational rows; JSON is legacy-read compatibility only. Never infer historical enrollments or allocations. Keep ambiguous legacy invoices in the controlled reconciliation path. Run read-only audit and preflight before the operator-run migration, then post-audit before deployment; never auto-migrate or auto-repair production finance data.