---
name: Arrears-First Manual Payment
description: How the arrears-first manual allocation endpoint works
---

# Arrears-First Manual Payment

## Endpoint
`POST /api/enhanced-invoices/manual-payment/apply-arrears-first`

Body: `{ student_id, amount, payment_date, description?, reference? }`

## Logic
1. Fetches all `Unpaid`/`Partial` invoices for student, ordered by `due_date ASC`
2. Loops oldest-first, applies amount until exhausted
3. Uses `db.pool.connect()` transaction to atomically update invoices + insert payment_transactions rows
4. Descriptions are tagged `[Arrears from YYYY]` for previous-year invoices
5. Returns `allocations` array + `arrearsCount` / `currentCount` totals

## API service
`paymentsAPI.applyArrearsFirst(data)` in `client/src/services/api.js`

## UI
In `ManualPayments.js`, Step 2 now has two buttons:
- "Apply to Oldest Unpaid" (purple) → `paymentMode='arrears'` form
- "Specific Month/Year" (green) → existing form

Edit mode always sets `paymentMode='specific'`.

**Why:** Admin needs to clear arrears when a parent pays a lump sum, ensuring oldest debt is cleared first.
