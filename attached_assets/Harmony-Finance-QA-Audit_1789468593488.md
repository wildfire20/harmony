# Harmony Learning Institute — Finance QA Audit

**Audit dates:** 14–15 September 2026  
**Result:** Significant defects found. Authorized R0.01 Parent submission, Admin approval and automatic allocation passed. Reversal is blocked; the synthetic cent remains allocated in the last verified state.  
**Environment:** https://www.harmonylearning.co.za — authenticated Parent and Admin interfaces.  
**Source:** [wildfire20/harmony](https://github.com/wildfire20/harmony), pinned ref `a9acbce8fe11d704f96b27ae1ff640fa4636acb8`. The deployed commit was not independently verified.

## Scope and safeguards

Reviewed navigation, invoices, payable obligations, recurring and one-off fees, receipt preview, proof form validation, pending allocations, payment history, reconciliation entry, discount logic, audit log, and export preview/code. The supplied Parent session was linked to HAR049; Admin had super-admin access. Learner names and unrelated family details are omitted here.

No production records were deleted, no real payments approved, no charges created, and no real learner details changed. The specifically authorized synthetic R0.01 proof was approved during continuation; its reversal has not been confirmed. After the initial audit, the user expressly authorized using HAR049 and submitting the exact R0.01 QA proof. That proof was successfully submitted; see the continuation record below. Invalid empty/negative form checks stopped at validation. Existing payments and approvals described below predate this audit. Local reproduction tests used mocks with real database access explicitly blocked.

Parent and Admin access were subsequently restored and verified. A later browser timeout at the reversal prompt now blocks continuation. Download capture also failed; this is a testing limitation, not proof that downloads fail for users. This report is a reviewable audit checkpoint, not a full system pass or a claim that every possible defect has been found.

## Principal findings

1. A parent sees **R7,050 outstanding**, but the proof form offers neither the outstanding recurring obligations nor the R1,200 fun-day invoice.
2. Admin history reports **R32,150 unallocated credit**, absent from the parent's balance view and payment prompt. This requires reconciliation; it does not establish a refund entitlement.
3. CSV export ignores the learner filter and, with All Months selected, the year filter. Isolated execution reproduced both defects.
4. Discount stacking can produce **R250 discount lines on R200 charges**. Net invoice generation clamps to zero, concealing the inconsistent breakdown.
5. Existing allocation proposals can show every target unavailable while showing R0 needing review and an enabled Approve control.

## Baseline reconciliation: HAR049

| Invoice grouping | Billed | Paid | Outstanding |
|---|---:|---:|---:|
| January–March recurring | R7,050 | R7,050 | R0 |
| April recurring | R2,350 | R1,400 | R950 |
| May–June recurring | R4,700 | R4,700 | R0 |
| July recurring | R2,350 | R2,150 | R200 |
| August recurring | R2,350 | R0 | R2,350 |
| September recurring | R2,350 | R0 | R2,350 |
| September fun-day one-off | R1,200 | R0 | R1,200 |
| September test one-off | R300 | R300 | R0 |
| **Total: 11 invoices** | **R22,650** | **R15,600** | **R7,050** |

Parent invoices, Admin filtered invoices and history preview agreed on these totals. History separately exposed R32,150 credit/unallocated: twelve R2,350 payments plus R3,950. These funds were not allocated during the audit. Outstanding invoices and unallocated funds must be presented separately until reconciled; blindly netting them would also be unsafe.

## Coverage

| Area | Completed | Remaining |
|---|---|---|
| Navigation and login | Parent home/fees/proof/history and Admin finance tabs; login redirect observed | Fresh authentication, browser Back/deep-link and multi-child checks |
| Invoices | Eleven rows, cross-view totals, snapshots and descriptions | PDF invoice output and additional learner cases |
| Recurring obligations | Missing options reproduced live; source traced | Controlled partial/multiple-period submission |
| One-off fees | Paid fee disabled; unpaid invoice missing; active-fee view inspected | Controlled active/deactivated/pending transition |
| Receipt preview | Image decoded successfully (1254 × 1254); PDF iframe opened | PDF contents, download bytes, keyboard focus cycle |
| Proof submission | Empty/negative validation; authorized R0.01 submission and Pending Review history passed; invoice totals unchanged | Duplicate submission, upload validation and post-approval history |
| Admin allocation | Existing proposal inspected; blank reason blocked; QA proof #8 approved and automatically allocated R0.01 to April | Manual retarget/save, reject, and complete audit/export verification |
| History | Allocated/unallocated rows, methods, credit and preview; PROOF-8 allocation and correction form inspected | Reversal stalled at browser prompt; no reversal confirmed |
| Reconciliation | Page and empty-form validation; source inspected | Bank import and controlled missing-charge creation |
| Discounts | Source review and isolated arithmetic reproduction | Admin/Parent request, approval, rejection, effective dates and generated invoice cycle |
| Exports | Preview checked; CSV handler executed with mock rows | Capture actual CSV/XLSX and validate bytes, formulas, formatting and parity |
| Ledger tests | Existing suite: **14 passed, 0 failed** with mocked DB | Live database transaction/integration and authorization tests |

## Findings register

Severity: **High** affects payment completion, financial accuracy or export scope; **Medium** materially misleads users or obstructs review; **Low** affects clarity or usability. “Code reproduced” means isolated execution, not a production transaction. “Observed + code” links a live symptom to relevant source; deployed-version parity remains unverified.

### F01 — High: outstanding recurring charges cannot be selected

**Evidence: observed + code.** Open Parent Fees → Submit Proof for HAR049. Recurring balances total R5,850, yet no recurring service choices appear. The parent cannot clearly target the visible debt.

The form derives options from persisted charge lines/category balances. Legacy invoices without those lines disappear. Admin's legacy tuition fallback additionally requires a tuition/school-fee description; the inspected recurring rows have no useful description.

**Expected/fix:** Every positive payable balance must have an explicit selectable target or a visible reconciliation explanation. Backfill or reconcile legacy categories with provenance; do not infer new charges from current service prices. **Acceptance:** All five outstanding recurring rows are accounted for without changing amounts.

**Source:** [ParentPaymentProof.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentPaymentProof.js), option-building effect around line 111; [paymentProofs.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/paymentProofs.js), legacy fallback around lines 266 and 821.

### F02 — High: unpaid one-off invoice absent from payable options

**Evidence: observed + code; underlying record state inferred.** Parent invoices show the R1,200 fun-day balance. Submit Proof lists only the already-paid R300 test fee, disabled. Admin active One-Off Fees likewise lacks fun-day.

The child-fee endpoint requires `f.is_active = true`. A surviving invoice can therefore be excluded because its fee definition is inactive. Deactivation is a plausible explanation here, not a directly inspected database fact; pending allocations must also be considered.

**Expected/fix:** Base payable obligations on outstanding ledger charges, displaying any pending reservation explicitly. Archiving a definition must not silently hide existing debt. **Acceptance:** The R1,200 appears as payable or clearly reserved, with invoice identity and reason.

**Source:** [studentFees.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/studentFees.js), `/for-child`, active filter around line 423.

### F03 — High: credit omitted from parent payment context

**Evidence: observed + code.** Parent Home requests action for R7,050 outstanding. Admin history/export preview separately shows R32,150 credit/unallocated. Parent has no corresponding warning or reconciliation state.

**Expected/fix:** Show invoice debt, unapplied funds and reconciliation status distinctly. Avoid prompting another payment without acknowledging recorded funds. **Acceptance:** Parent and Admin display the same ledger components; staff can explain which funds remain available and why. Do not automatically apply or refund these historic entries without validation.

**Source:** [ParentInvoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentInvoices.js), totals UI; [financeLedger.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/services/financeLedger.js), ledger summary; [enhanced-invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/enhanced-invoices.js), history summary.

### F04 — Medium: genuine invoice snapshots labelled unavailable

**Evidence: observed + code reproduced.** Every Parent invoice displays the legacy-snapshot-unavailable message, including one-offs with line details visible to Admin. `getStudentLedger` returns line items without `snapshot_available`; the Parent UI requires both.

**Expected/fix:** Return a consistent snapshot contract or derive availability from validated persisted lines. **Acceptance:** Mock invoice with one line yields `snapshot_available: true`; real detailed invoices show their lines while genuinely legacy invoices keep the warning.

**Source:** [financeLedger.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/services/financeLedger.js), compare `buildInvoiceBreakdown` around line 125 with `getStudentLedger`; [ParentInvoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentInvoices.js), line 202.

### F05 — High: stale allocation proposal appears ready for approval

**Evidence: observed + code.** Existing proof #6 totals R4,200: tuition R2,350, transport R650 and `one_off:4` R1,200. All three draft targets display unavailable, yet Unallocated/review is R0 and Approve remains enabled. Only the fun-day R1,200 option is selectable. No approval was attempted.

The UI matches composite option keys; legacy category identifiers can fail to match normalized choices. The arithmetic remainder does not establish target validity. Server-side validation exists, but its live rejection/success path was not exercised.

**Expected/fix:** Validate each target and amount before presenting readiness; show unavailable-target count and require retargeting/removal. Normalize legacy identifiers explicitly. **Acceptance:** This proposal cannot appear ready until all R4,200 has a valid disposition.

**Source:** [PendingPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/PendingPayments.js), `optionKey` and draft selectors around lines 366–387; [paymentProofs.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/paymentProofs.js).

### F06 — High: CSV export ignores learner and year filters

**Evidence: code reproduced; live file not captured.** Filter Admin invoices to HAR049 and select a year with All Months. Export code sends no learner filter. Backend has no learner predicate and applies year only inside `if (month && year)`.

An isolated handler execution with `studentNumber=QA001&year=2026` bound no SQL parameters and included a mocked different learner from 2025. This risks exporting broader student data than the visible selection and producing wrong period totals.

**Expected/fix:** Share validated filter parsing between list, summary and export; apply year independently. **Acceptance:** Export row identities exactly match the filtered result across learner-only, year-only and combined filters.

**Source:** [PaymentDashboard.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/PaymentDashboard.js), line 223; [invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/invoices.js), `/export/csv`, line 1491.

### F07 — High: discounts can exceed gross charges

**Evidence: code reproduced.** Charges: tuition R100 and transport R100. Apply tuition-specific fixed R100, general fixed R100, then transport-specific fixed R100. The function emits discount lines R100 + R100 + R50 = R250. Invoice generation subsequently clamps net due to R0.

A scoped assignment is capped by remaining service capacity without also capping by remaining invoice capacity. General-discount distribution can leave service capacity after invoice capacity is exhausted.

**Expected/fix:** Cap each discount by both remaining invoice and target capacity, and account consistently for general discounts across services. **Acceptance:** Sum of discounts never exceeds gross; each service's discounts stay within its charge; test permutations and rounding. Confirm intended ordering semantics rather than silently changing policy.

**Source:** [financeLedger.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/services/financeLedger.js), `calculateApprovedDiscounts`, line 303.

### F08 — Medium: CSV bypasses ledger-derived balances

**Evidence: code reproduced.** CSV reads stored invoice balance/status columns directly. A mock row with due R100, paid R20 and stale stored outstanding R999 exports R999, rather than the basic R80 balance. Live source data staleness was not established.

**Expected/fix:** Export the same authoritative ledger projection as the dashboard, including correction/carry-forward semantics. **Acceptance:** CSV, invoice UI and history agree after allocation and reversal cases.

**Source:** [invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/invoices.js), CSV SELECT and row mapping around line 1491.

### F09 — Medium: future unpaid invoices labelled missed payments

**Evidence: observed + code.** Export preview reports three Missed Payments, including September invoices due after the audit date. Its status mapping calls every unpaid invoice “Missed Payment” without checking the due date.

**Expected/fix:** Separate not-yet-due, overdue, partial and paid states using an explicit school timezone and as-of date. **Acceptance:** September 23/29 obligations are unpaid but not missed on September 14/15.

**Source:** [enhanced-invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/enhanced-invoices.js), status mapping around line 824.

### F10 — Medium: audit log hides allocation structure

**Evidence: observed + code.** Existing proof #7 allocation adjustment renders before/after values as `[object Object]`. The renderer converts values with `String(v)`, truncates at 40 characters and shows only four fields.

**Expected/fix:** Expandable structured before/after data with amount, target, actor, timestamp and reason. **Acceptance:** A reviewer can reconstruct the complete allocation change from the UI without database access.

**Source:** [AuditLog.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/AuditLog.js), lines 49–52.

### F11 — Medium: proof payments mislabelled Bank Import

**Evidence: observed + code.** ManualPayments history labels PROOF-5 and PROOF-7 entries Bank Import. The UI labels only `manual_entry` as Manual and every other method as Bank Import, including proof-of-payment records.

**Expected/fix:** Explicit method/channel mapping with a safe unknown value. **Acceptance:** Proof, bank import and manual entries retain distinct provenance after splitting allocations.

**Source:** [ManualPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/ManualPayments.js), line 606.

### F12 — Medium: date-only values display different calendar dates

**Evidence: observed; cause inferred from code.** Fun-day is dated September 23 in Admin invoice/fee displays, but September 24 in the allocation option. Proof history also differs by one calendar day between views. Timestamp submission date and effective payment date may legitimately differ; the invoice due-date mismatch is the stronger evidence.

Multiple views use `new Date(value).toLocaleDateString()` with different locale handling. A timezone conversion is a likely contributor; stored date corruption was not demonstrated.

**Expected/fix:** Treat calendar dates as dates, and timestamps as zoned instants. **Acceptance:** Identical invoice due date in Parent, Admin, allocation, CSV and XLSX under multiple browser timezones.

**Source:** [PaymentDashboard.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/PaymentDashboard.js), line 508; [PendingPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/PendingPayments.js), `fmt`; [ManualPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/ManualPayments.js), date renderers.

### F13 — Medium: dashboard cards mix population and invoice counts

**Evidence: observed + code.** With HAR049 selected, cards show Total Students 315, Paid 6, Unpaid 3 and Outstanding R7,050. The first count is school-wide; the others describe filtered invoices, not students. Two partially paid invoices are not represented by the paid/unpaid counts.

**Expected/fix:** Label count units and scope explicitly; filter consistently or visibly separate school totals. **Acceptance:** A user can reconcile all 11 filtered invoices across paid, partial and unpaid states.

**Source:** [invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/invoices.js), global active-student count around line 714; [PaymentDashboard.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/PaymentDashboard.js), summary cards.

### F14 — Medium: pricing guidance contradicts invoice-based payment choices

**Evidence: observed + code.** Admin Service Pricing says prices are shown in Submit Proof, tuition appears for all parents and changes take effect immediately for all parents. The Parent implementation deliberately derives payable choices from invoice evidence; enrollment is labelled separately.

**Expected/fix:** Explain that pricing config affects eligible future charge generation, with effective-date rules, while existing invoices remain authoritative. **Acceptance:** Guidance matches actual generation and Parent behaviour without implying that editing prices changes existing debt.

**Source:** [ServicePricingAdmin.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/ServicePricingAdmin.js), lines 97 and 236–239; [ParentPaymentProof.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentPaymentProof.js), line 111.

### F15 — Medium: empty/error responses can resemble healthy empty finance data

**Evidence: source review, not fault-injected live.** Parent proof loading parses response JSON without consistently checking `res.ok`; Admin pending-loading paths can fall back to empty lists. Parent banking-detail errors are swallowed and may leave Loading displayed.

**Expected/fix:** Distinguish loading, empty, expired session and server error states; provide retry. **Acceptance:** Controlled 401/403/500 cases never report “no payments” as if data were successfully loaded.

**Source:** [ParentPaymentProof.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentPaymentProof.js), fetch effects; [PendingPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/PendingPayments.js), loading; [ParentInvoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentInvoices.js), banking details.

### F16 — Medium: parent login can redirect into staff/student login

**Evidence: observed; conditional source explanation.** An initial Parent login attempt landed at `/login`, the Student/Staff screen. Manual Parent sign-in subsequently worked. The shared API interceptor redirects 401 responses to `/login`, including Parent authentication requests. The exact response status of the failed attempt was not captured.

**Expected/fix:** Keep Parent login errors in the Parent flow; use role-aware session-expiry handling. **Acceptance:** Invalid and expired Parent credentials stay on `/parent/login` with an appropriate message.

**Source:** [api.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/services/api.js), response interceptor; [ParentLogin.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentLogin.js).

### F17 — Medium: CSV formula-like text is not neutralized

**Evidence: code reproduced; spreadsheet execution not tested.** A reference `=1+1` is emitted as a quoted CSV cell unchanged. CSV quoting escapes delimiters, but does not reliably prevent spreadsheet formula interpretation.

**Expected/fix:** Apply an explicit spreadsheet-safe text policy to user-controlled identifiers and names. **Acceptance:** Formula-prefix fixtures open as text in supported spreadsheet applications while legitimate numeric amounts remain numeric. Actual exploitability depends on input paths and spreadsheet behaviour.

**Source:** [invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/invoices.js), CSV string escaping.

### F18 — Medium: allocation and export rows lack sufficient invoice identity

**Evidence: observed + code.** History allocation dropdown offers September 2026 R1,200 and September 2026 R2,350 without fee name/reference. Export preview has three September rows primarily distinguished by amounts.

**Expected/fix:** Include invoice reference, description/service and due date in targets and history exports. **Acceptance:** An administrator can distinguish recurring tuition from each one-off without inferring from amount.

**Source:** [ManualPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/ManualPayments.js); [StudentPaymentExport.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/StudentPaymentExport.js).

### F19 — Low: included-service label uses the wrong property

**Evidence: source contract mismatch.** Normalized lines expose `included`; Parent and Admin invoice renderers check `is_included`. Included labels can disappear even when the snapshot exists.

**Expected/fix:** Standardize the serialized property and render included components distinctly. **Acceptance:** A bundled/included charge fixture displays Included in both roles.

**Source:** [financeLedger.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/services/financeLedger.js), line 54; [ParentInvoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentInvoices.js), line 206; [PaymentDashboard.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/PaymentDashboard.js), line 882.

### F20 — Low: export learner grade and month count are misleading

**Evidence: grade observed; month count source-only.** Export learner search/preview shows Grade N/A for HAR049 while Parent shows Grade 2. Separately, `totalMonths` counts invoice rows with a positive charge, so multiple one-offs in one month inflate a month count (11 invoices across nine months here).

**Expected/fix:** Preserve grade in the learner lookup and count distinct year-months, or rename the metric Invoice Count. **Acceptance:** Grade 2 is retained; January–September reports nine months irrespective of one-offs.

**Source:** [StudentPaymentExport.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/payments/StudentPaymentExport.js); [enhanced-invoices.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/routes/enhanced-invoices.js), line 870. The missing-grade join/serialization cause requires follow-up.

### F21 — Low: receipt modal keyboard and overflow issues

**Evidence: observed + source review.** Escape did not close the Parent receipt modal. The modal lacks a complete dialog/focus-management pattern. A long receipt filename also overflowed the Admin modal horizontally during inspection.

**Expected/fix:** Escape close, focus trap/restore, accessible dialog name, keyboard-operable close, and wrapping filenames. **Acceptance:** Complete preview/open/close using keyboard and narrow viewport without horizontal overflow. Image preview passed; PDF content itself remains unverified.

**Source:** [ParentPaymentProof.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentPaymentProof.js), receipt modal; [PendingPayments.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/admin/PendingPayments.js), modal layout.

### F22 — Medium: deselecting all obligations can leave a stale amount

**Evidence: source review, not reached live because payable options were missing.** `recalcTotal` updates the payment amount only when total is greater than zero. Removing the last selection therefore retains the prior amount.

**Expected/fix:** Clear/reset the derived amount when selection reaches zero, or explicitly switch to a clearly labelled unallocated-payment mode. **Acceptance:** Selecting then deselecting the last item cannot silently submit the former amount.

**Source:** [ParentPaymentProof.js](https://github.com/wildfire20/harmony/blob/a9acbce8fe11d704f96b27ae1ff640fa4636acb8/client/src/components/parent/ParentPaymentProof.js), lines 144–148.

## Checks that passed and important distinctions

- Parent/Admin/history preview totals reconcile for the inspected learner.
- Paid R300 one-off is disabled for further selection.
- Empty and negative Parent amounts were blocked; blank Admin adjustment reason was blocked.
- Empty missing-charge reconciliation form was blocked. The page warns that it creates an audited charge rather than rewriting history. No valid creation was attempted.
- Parent image receipt loaded and decoded successfully; PDF preview created an iframe, which is only a partial check.
- Existing Parent approved proofs total R1,200 and R4,250. Admin history shows the latter split R300 allocated and R3,950 unallocated, preserving its total.
- A pending proof submitted by another linked parent is not necessarily expected in this Parent's own submission history. Its absence was not recorded as a defect.
- Service enrollment being separate from charges is intentional and appropriate; the contradictory Admin guidance is the defect.
- Existing ledger unit tests passed all 14 cases, including allocation channels, unallocated credit, carry-forward and reversal/idempotency scenarios. Passing mocked tests does not demonstrate live database correctness.

## Isolated reproduction evidence

Tests used the pinned source snapshot. A preload stub throws on attempted real database access. The four additional probes executed the actual ledger helper or extracted CSV handler with mock input; no production API writes occurred.

| Probe | Result |
|---|---|
| Persisted invoice line | 1 line returned; `snapshot_available` missing; expected true |
| Scoped → general → scoped discounts | Gross 200; discount lines 100, 100, 50; total 250; generated net clamped to 0 |
| CSV learner + year, no month | Bound parameters empty; no learner/year predicates; mock different learner/prior year included |
| CSV stale balance/formula text | Stored 999 exported despite 100−20=80; `=1+1` remained formula-like text |

Existing suite invocation: `node --require ./qa-no-db.cjs --test tests/finance-ledger.test.js` — **14 tests, 14 passed, 0 failed**. These are local, mocked tests. No new regression fix was applied.

## Required continuation to complete end-to-end QA

1. Restore Admin sign-in. Parent access is verified. The user confirmed HAR049 is their brother’s account and authorized using it for the labelled QA workflow. Historic records remain out of scope for modification.
2. Continue Admin handling of the already-submitted R0.01 QA proof identified below. Inspect allocation, approve only this labelled test record as authorized, and verify totals/audit/export parity. Test rejection and duplicate/retry separately. Do not submit the same proof again merely because Admin access is pending.
3. Test discounts with approved disposable fixtures: fixed/percentage, scoped/general stacking, rejection, date boundaries and generated invoice snapshots. Creating charges or changing real learner enrollment still requires the user's permission.
4. Test bank reconciliation using a synthetic, approved fixture; inspect duplicate import handling, unmatched funds and correction/reversal effects. No real bank statement was imported in this audit.
5. Capture CSV and XLSX bytes and compare row identities, amounts, due dates, descriptions, credit and formula safety against the UI and ledger.
6. Repeat role boundaries, multiple-child switching, expired-session states, date rendering and keyboard/mobile checks. Verify the deployed source revision before closing code-linked findings.

**Suggested repair order:** Fix export scope and discount caps first; reconcile the learner's invoice/credit state and restore payable options next; then fix allocation readiness, audit visibility, date/status semantics and presentation defects. Do not use repairs as a reason to silently rewrite historical finance data.


## Continuation record — authorized Parent submission

The user confirmed HAR049 may be used despite being a family learner account, then expressly approved the proposed QA submission. This approval does not make its historical finance records disposable.

- **Reference:** `QA-HAR049-20260915-01`
- **Amount:** R0.01
- **Method:** EFT / Bank Transfer
- **Notes:** “USER-AUTHORIZED QA TEST ONLY. No money transferred. R0.01 synthetic proof to test submission, allocation and history for HAR049. Do not treat as a real payment.”
- **Receipt:** None; the form explicitly allows an optional receipt.
- **Result:** Success message displayed; one new row appeared in Parent history as **Pending Review**, with the correct reference, amount and method. Displayed submission time: 15 Sept 2026, 03:07 (browser-formatted).
- **Pending balance check:** Billed R22,650, paid R15,600, outstanding R7,050 remained unchanged after submission. This is the expected pre-approval behaviour.
- **Payable-option defects:** Still reproduced: no recurring target choices and only the paid R300 one-off listed. The test was consequently submitted without a selected obligation.
- **Admin access:** A separate tab opened the known `/payments` route and redirected to `/login`; Parent access remains available. Admin allocation/approval has not yet occurred.
- **Record handling:** Retain this reference to avoid accidental duplicate submission. The record is synthetic; it must not be confused with a bank-confirmed receipt.


## Continuation record — Admin approval and blocked reversal

Admin sign-in succeeded. Pending Payments displayed exactly one matching **submission #8**, reference `QA-HAR049-20260915-01`, R0.01, with the full synthetic-test note. The unrelated R4,200 submission was not changed.

The Admin note explicitly recorded that no bank funds were received. Approval of #8 succeeded and the pending count fell from two to one. Manual Payment History then showed **PROOF-8, R0.01, April 2026**. April outstanding became **R949.99**, confirming automatic oldest-unpaid allocation. The R0.01 was not left as unallocated credit.

The adjustment form displayed payment date **2026-09-15**, while the history row displayed **9/14/2026**, strengthening F12 with a same-record date discrepancy. The history labelled it Bank Import (F11); the adjustment form defaulted to Manual entry. No adjustment was saved.

After Admin sign-in, the still-open Parent tab retained Emilia’s identity but displayed **No submissions yet** when its proof history reloaded. Before Admin sign-in the same tab showed the QA pending row and two approved proofs. This strengthens F15: a changed/shared authentication state can look like successfully loaded empty data. No fresh Parent authentication was performed after that switch, so post-approval Parent status remains unverified.

**Reversal attempt:** Cancelled the adjustment form, then clicked Reverse Payment only in the PROOF-8 row. The click timed out; querying the JavaScript dialog also timed out. Source shows this action first opens a reason prompt, then a confirmation, before issuing the reversal request. Neither reason nor confirmation was completed by the assistant. No reversal success was observed. **Treat PROOF-8 as still approved and allocated until a fresh ledger check proves otherwise.** Do not delete the proof or alter historic payments to compensate.

### F23 — Medium: no allocation editor for an initially untargeted proof

**Observed + code.** QA proof #8 had no selected obligation because Parent choices were missing. Admin showed no Proposed Allocations section, Add control or unallocated amount. Source gates the entire editor on `allocationDraft.length > 0` in `PendingPayments.js` around line 357. Thus Admin cannot create the first target through this editor. Approval automatically allocated to April without an invoice preview.

**Fix/acceptance:** Show an empty allocation editor for pending proofs, explain the default destination, and allow adding the first valid target. Test zero-row submissions independently from editing existing proposals.

### F24 — Medium: payment correction form silently changes method selection

**Observed; save path not exercised.** Opening Adjust Payment for PROOF-8 showed Manual entry selected although the submission method was EFT and the stored proof channel is distinct. The edit form’s available methods omit the proof-specific value. Saving an unrelated correction may therefore change provenance; this outcome requires an isolated save test before being called confirmed data corruption.

**Fix/acceptance:** Preserve original channel and method separately, include or explicitly represent the current value, and prevent incidental changes when correcting date/reference. Source: `client/src/components/admin/ManualPayments.js`, edit initialization and payment-method select.

**Immediate continuation:** Restore browser control at the reversal prompt. Reverse only PROOF-8/R0.01 with reason “QA test complete; reverse synthetic cent; no money transferred”, preserving audit history. Verify April returns to R950.00 and overall outstanding to R7,050.00. Then complete audit log/export and role-session tests. Existing fixture authorization remains valid; another generic permission request is unnecessary.
