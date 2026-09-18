---
name: Terminal invoice cancellation
description: Durable Finance rule for preserving cancelled invoice evidence without exposing cancelled debt as payable.
---

`Cancelled` is a terminal invoice state. Keep the original invoice, line items,
amounts, payments, allocations, reversals, and audit evidence. Existing finance
commands must reject operations that would edit, allocate, reverse, recalculate,
or carry forward a cancelled invoice.

Admin history retains the cancelled invoice and its original financial details,
but presents zero active outstanding. Parent-facing invoice lists, totals,
outstanding balances, and payment options exclude it.

**Why:** Cancellation must remove accidental debt without rewriting financial
history or allowing a later generic finance command to reactivate it.

**How to apply:** Preserve `Cancelled` before amount-derived status calculation,
exclude it from active projections, and require guarded canonical transactions
plus durable audit evidence for cancellation operations.