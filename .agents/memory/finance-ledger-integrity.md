---
name: Finance ledger integrity
description: Durable rules for reconciling invoices, payment allocations, carry-forward balances, and reversals.
---

Admin and Parent financial totals must come from the same authoritative ledger calculation. Billed amounts, allocated payments, unallocated credit, overpayments, arrears, and carry-forward balances must retain distinct meanings rather than being cosmetically reconciled.

Carry-forward invoices require explicit source-to-successor lineage. Original invoices remain as audit history but are excluded from active totals. Payment corrections use immutable compensating events with a database-enforced single-reversal invariant; they never delete history or adjust invoices by a broad month/year match.

**Why:** Aggregate carry-forward invoices and repeated payment edits can otherwise double-count debt, reverse unrelated allocations, or make Admin and Parent balances disagree.

**How to apply:** Allocate under transaction locks, target exact allocation and successor identities, expose reversal state, fail closed when historical lineage is ambiguous, and test Admin/Parent equality across every payment channel.