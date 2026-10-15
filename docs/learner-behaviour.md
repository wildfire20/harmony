# Merits & Demerits and statement printing

## Staff workflow

Open **Merits & Demerits** in the staff menu. Search by learner name or HAR reference and select the learner. Admin and Super Admin can work with every active learner. Teachers can work only with learners in their currently assigned grade and class.

Choose **Merit** or **Demerit**, select a school reason, choose the date and enter optional notes. Notes are visible to linked parents. Select **Save record**. Repeated submissions with the same request key create one record and one audit entry.

Admin can open **Manage types** to add or edit the catalogue and deactivate a type for future use. Codes and the Merit/Demerit classification cannot be changed after creation. Existing records keep a snapshot of the original label, category and points.

Use **Correct entry**, enter a reason and select **Confirm correction** to exclude an incorrect entry from totals. The original remains visible with its correction reason. Add a replacement record separately when needed. Teachers can correct their own entries for currently assigned learners. Admin can correct any entry.

The initial catalogue contains six merit reasons from the supplied Super Star Student form and 39 demerit reasons from the supplied discipline form. Merit awards are counted and have no invented point value. Demerit points are separate: Category 1 is 2, Category 2 is 10 except code 2001 at 6, Category 3 is 15 and Category 4 is 20. The supplied Category 3 list starts at 3002; no 3001 was invented. Code 3008 retains the source form's wording, “Sexual, religious, racial affliction”, for the school to review through Manage types.

Category 4 entries display an Admin review notice. Saving an entry never suspends or expels a learner. No email or WhatsApp messages are sent by this feature.

## Parent workflow

Open **Merits & Demerits** in the Parent Portal menu. On a phone, open the menu in the header. Select the correct child using the existing child switcher. Parents can see only their linked children's history and separate merit counts, demerit counts and demerit points. They cannot create, edit or remove entries. Corrected entries remain visible and are excluded from totals.

The year and Merit/Demerit filters apply to history. Summary totals cover all active entries in the selected year. History has bounded pagination. Switching children clears the previous child's records and ignores late responses.

## Migration and release

The additive migration creates only `behaviour_types` and `behaviour_records`, their indexes and history protection trigger. It seeds catalogue choices and does not import incidents from photographed forms. It does not change users, teacher assignments, Parent links or financial data. Startup never runs the migration.

The existing release command, `npm run migrate:parent-portal`, now applies and verifies the enquiry, re-registration and behaviour migrations together in one transaction. It verifies all 45 initial behaviour codes before reporting success. Railway's existing pre-deploy step can therefore prepare the new tables without a separate shell session.

For a standalone behaviour migration, the operator can also run:

```sh
npm run migrate:learner-behaviour
```

The runner uses the configured database, wraps migration and verification in one transaction, and reports success only after commit. It can be repeated without overwriting Admin catalogue edits. Until the migration is applied, the feature returns a clear 503 message.

Tests use an explicit disposable `FINANCE_TEST_DATABASE_URL`. The standard Finance integration runner includes real HTTP/session/role checks and database regressions for this feature. Client tests and print-layout checks are included in `npm run release-gate`.

## Statement printing

**Payments → Invoices → Student Payment History Export → Download Excel** retains the financial data and detailed worksheets. The main **Monthly School Account** worksheet uses a smaller logo area, removes redundant spacer rows, places banking details beside the summary, wraps table headings and sets an explicit A4 landscape print area. Normal annual statements fit one page; long histories and unusually long text may continue onto additional pages to retain readable content. Select the main worksheet when printing the account statement. Extra workbook sheets remain available for detailed review.

Tests verify saved Excel page settings and numeric values. Native Excel printer output should also be checked using Print Preview on the school's computer.
