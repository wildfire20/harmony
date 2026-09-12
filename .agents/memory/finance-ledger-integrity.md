---
name: Finance ledger integrity
description: Durable rules for reconciling invoices, payment allocations, carry-forward balances, and reversals.
---

Admin and Parent financial totals must come from the same authoritative ledger calculation. Billed amounts, allocated payments, unallocated credit, overpayments, arrears, and carry-forward balances must retain distinct meanings rather than being cosmetically reconciled.

Carry-forward invoices require explicit source-to-successor lineage. Original invoices remain as audit history but are excluded from active totals. Payment corrections use immutable compensating events with a database-enforced single-reversal invariant; they never delete history or adjust invoices by a broad month/year match.

Historical invoice charges and discounts must come from immutable invoice-line snapshots. Current service prices, enrollment flags, legacy discount flags, or transaction month/year metadata must never be used to reconstruct what an old invoice meant.

**Why:** Aggregate carry-forward invoices and repeated payment edits can otherwise double-count debt, reverse unrelated allocations, or make Admin and Parent balances disagree. Current configuration can change after billing, and payment metadata can describe a different month from the invoice that actually received the allocation.

**How to apply:** Allocate under transaction locks, target exact allocation and successor identities, snapshot approved charges and discounts when invoices are issued, expose reversal and review state, fail closed when history is ambiguous, and test Admin/Parent/export equality across every payment channel.