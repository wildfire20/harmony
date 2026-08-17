---
name: Audit Trail System
description: How the audit log is structured and which routes are wired
---

# Audit Trail

## Table
`audit_logs`: id, user_id, user_name, user_role, action (slug), entity_type, entity_id, details (JSONB), ip_address, created_at

## Helper
`utils/auditLogger.js` exports `logAudit(options)` and `getIp(req)`.
logAudit is non-blocking (catches and logs errors without throwing).

## Routes wired
- `routes/enhanced-invoices.js` — manual_payment_add, manual_payment_edit, manual_payment_delete, manual_payment_arrears
- `routes/invoices.js` — invoice_generate, invoice_carry_forward, manual_arrears_created
- `routes/paymentProofs.js` — payment_proof_approve, payment_proof_reject, payment_proof_delete

## Frontend
- `client/src/components/admin/AuditLog.js` — filterable paginated table
- Accessible as "Audit Log" tab in `client/src/components/payments/PaymentsHub.js`

## API
- `GET /api/audit-logs` — paginated, filterable by action, entityType, dateFrom, dateTo, search
- `GET /api/audit-logs/actions` — distinct action types for dropdown

**Why:** School requires accountability for all financial and student record changes.
